import { Agent, request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { FleetActorContext } from '../../application/fleet/fleet.types';
import {
  FleetConflictError,
  FleetNotFoundError,
  FleetProtocolError,
  FleetUnavailableError,
} from '../../application/fleet/errors/fleet-errors';

export interface FleetHttpConfig {
  readonly baseUrl: string;
  readonly clientCertificate: string;
  readonly clientKey: string;
  readonly caCertificate?: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxResponseBytes: number;
  readonly maxRetryDelayMs: number;
}

export interface FleetHttpRequest {
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly path: string;
  readonly actor: FleetActorContext;
  readonly operationId: string;
  readonly idempotencyKey?: string;
  readonly body?: unknown;
}

export interface FleetHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export type FleetHttpExecutor = (
  url: URL,
  request: FleetHttpRequest,
  config: FleetHttpConfig,
) => Promise<FleetHttpResponse>;

export class FleetHttpClient {
  constructor(
    private readonly config: FleetHttpConfig,
    private readonly executeHttps: FleetHttpExecutor = executeHttpsRequest,
    private readonly delay: (milliseconds: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async request<T>(request: FleetHttpRequest): Promise<T> {
    const url = new URL(
      request.path.replace(/^\//, ''),
      ensureBasePath(this.config.baseUrl),
    );
    const maxAttempts = this.config.maxRetries + 1;
    const deadline = Date.now() + this.config.timeoutMs;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new FleetUnavailableError(isMutation(request));
      }
      let response: FleetHttpResponse;
      try {
        response = await this.executeHttps(url, request, {
          ...this.config,
          timeoutMs: remainingMs,
        });
      } catch (error) {
        if (error instanceof FleetResponseTooLargeError) {
          throw new FleetProtocolError();
        }
        if (attempt + 1 < maxAttempts) {
          const waitMs = backoff(attempt);
          if (waitMs >= deadline - Date.now()) {
            throw new FleetUnavailableError(isMutation(request));
          }
          await this.delay(waitMs);
          continue;
        }
        throw new FleetUnavailableError(isMutation(request));
      }

      if (
        Buffer.byteLength(response.body, 'utf8') > this.config.maxResponseBytes
      ) {
        throw new FleetProtocolError();
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt + 1 < maxAttempts) {
          const wait =
            response.status === 429
              ? retryAfterMilliseconds(response.headers['retry-after'])
              : null;
          if (wait !== null) {
            if (
              wait > this.config.maxRetryDelayMs ||
              wait >= deadline - Date.now()
            ) {
              throw new FleetUnavailableError(isMutation(request));
            }
            if (wait > 0) await this.delay(wait);
            continue;
          }
          if (wait === null) {
            const waitMs = backoff(attempt);
            if (waitMs >= deadline - Date.now()) {
              throw new FleetUnavailableError(isMutation(request));
            }
            await this.delay(waitMs);
            continue;
          }
        }
        throw new FleetUnavailableError(isMutation(request));
      }
      if (response.status === 409) throw new FleetConflictError('CONFLICT');
      if (response.status === 404) throw new FleetNotFoundError();
      if (response.status < 200 || response.status >= 300) {
        throw new FleetProtocolError();
      }
      if (!response.body) return undefined as T;
      try {
        return JSON.parse(response.body) as T;
      } catch {
        throw new FleetProtocolError();
      }
    }
    throw new FleetUnavailableError(isMutation(request));
  }
}

class FleetResponseTooLargeError extends Error {}

function ensureBasePath(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function isMutation(request: FleetHttpRequest): boolean {
  return request.method !== 'GET';
}

function backoff(attempt: number): number {
  return Math.min(100 * 2 ** attempt, 1_000);
}

function retryAfterMilliseconds(value: string | undefined): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function executeHttpsRequest(
  url: URL,
  request: FleetHttpRequest,
  config: FleetHttpConfig,
): Promise<FleetHttpResponse> {
  return new Promise((resolve, reject) => {
    const body =
      request.body === undefined ? undefined : JSON.stringify(request.body);

    let receivedBytes = 0;
    const outgoing = httpsRequest(
      url,
      {
        method: request.method,
        headers: createFleetRequestHeaders(request, body),
        agent: createFleetHttpsAgent(config),
        signal: AbortSignal.timeout(config.timeoutMs),
        timeout: config.timeoutMs,
      },
      (incoming: IncomingMessage) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > config.maxResponseBytes) {
            incoming.destroy(new FleetResponseTooLargeError());
            return;
          }
          chunks.push(chunk);
        });
        incoming.on('end', () => {
          const responseHeaders: Record<string, string | undefined> = {};
          for (const [name, value] of Object.entries(incoming.headers)) {
            responseHeaders[name.toLowerCase()] = Array.isArray(value)
              ? value[0]
              : value;
          }
          resolve({
            status: incoming.statusCode ?? 0,
            headers: responseHeaders,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        incoming.on('error', reject);
      },
    );
    outgoing.on('timeout', () => outgoing.destroy(new Error('Fleet timeout')));
    outgoing.on('error', reject);
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });
}

export function createFleetHttpsAgent(config: FleetHttpConfig): Agent {
  return new Agent({
    cert: config.clientCertificate,
    key: config.clientKey,
    ca: config.caCertificate,
    rejectUnauthorized: true,
  });
}

export function createFleetRequestHeaders(
  request: FleetHttpRequest,
  body?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-arimms-actor-id': request.actor.actorId,
    'x-arimms-request-id': request.actor.requestId,
    'x-arimms-operation-id': request.operationId,
  };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(body));
  }
  if (request.idempotencyKey)
    headers['idempotency-key'] = request.idempotencyKey;
  return headers;
}

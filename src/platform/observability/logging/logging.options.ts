import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { LogLevel } from '@platform/config/logging.config';
import type { RuntimeEnvironment } from '@platform/config/env-files';
import { REQUEST_ID_HEADER } from '@platform/http/http.constants';

interface SerializedRequest {
  id: string;
  method: string;
  url: string;
}

interface SerializedResponse {
  statusCode: number | null;
  contentType?: string;
}

interface PinoSerializedResponse {
  statusCode: number | null;
  headers?: Record<string, number | string | string[] | undefined>;
}

export function createPinoHttpOptions(
  level: LogLevel,
  environment: RuntimeEnvironment = 'production',
) {
  return {
    level,
    customSuccessMessage: (
      request: IncomingMessage,
      response: ServerResponse,
      responseTime: number,
    ): string => {
      const contentType = response.getHeader('content-type');
      const responseType =
        typeof contentType === 'string'
          ? ` ${contentType.split(';', 1)[0]}`
          : '';

      return `${request.method ?? 'UNKNOWN'} ${stripQueryString(request.url)} -> ${response.statusCode}${responseType} (${Math.round(responseTime)} ms)`;
    },
    ...(environment === 'development'
      ? {
          transport: {
            target: resolve(
              process.cwd(),
              'src/platform/observability/logging/pino-pretty.transport.cjs',
            ),
            options: {
              colorize: true,
              ignore: 'pid,hostname,context',
              singleLine: true,
              translateTime: 'SYS:HH:MM:ss',
            },
          },
        }
      : {}),

    genReqId: (_request: IncomingMessage, response: ServerResponse): string => {
      const requestId = response.getHeader(REQUEST_ID_HEADER);

      if (typeof requestId === 'string') {
        return requestId;
      }

      const generatedRequestId = randomUUID();
      response.setHeader(REQUEST_ID_HEADER, generatedRequestId);

      return generatedRequestId;
    },

    serializers: {
      req: serializeRequest,
      res: serializeResponse,
    },

    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.set-cookie',
        'req.headers.x-api-key',
        'res.headers.set-cookie',
      ],
      censor: '[REDACTED]',
    },

    customLogLevel: (
      _request: IncomingMessage,
      response: ServerResponse,
      error: Error | undefined,
    ): 'info' | 'warn' | 'error' => {
      if (error || response.statusCode >= 500) {
        return 'error';
      }

      if (response.statusCode >= 400) {
        return 'warn';
      }

      return 'info';
    },
  };
}

export function serializeRequest(
  request: IncomingMessage & { id?: unknown },
): SerializedRequest {
  const requestId = request.id;

  return {
    id:
      typeof requestId === 'string' || typeof requestId === 'number'
        ? String(requestId)
        : 'unknown',
    method: request.method ?? 'UNKNOWN',
    url: stripQueryString(request.url),
  };
}

export function serializeResponse(
  response: PinoSerializedResponse,
): SerializedResponse {
  const contentType = response.headers?.['content-type'];

  return {
    statusCode: response.statusCode,
    ...(typeof contentType === 'string' ? { contentType } : {}),
  };
}

function stripQueryString(url: string | undefined): string {
  if (!url) {
    return '/';
  }

  const queryIndex = url.indexOf('?');

  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

import { randomUUID } from 'node:crypto';

/**
 * Reuses an ID already assigned by HTTP logging, or generates one when absent.
 *
 * @param request Incoming request that may already carry Pino's request ID.
 * @returns The request ID shared by logging and request context.
 */
export function getRequestId(request: { id?: unknown }): string {
  return typeof request.id === 'string' ? request.id : randomUUID();
}

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { LogLevel } from '@platform/config/logging.config';
import { REQUEST_ID_HEADER } from '@platform/http/http.constants';

interface SerializedRequest {
  id: string;
  method: string;
  url: string;
}

interface SerializedResponse {
  statusCode: number;
}

export function createPinoHttpOptions(level: LogLevel) {
  return {
    level,

    genReqId: (_request: IncomingMessage, response: ServerResponse): string => {
      const requestId = response.getHeader(REQUEST_ID_HEADER);

      if (typeof requestId !== 'string') {
        throw new Error(
          'Request context must set the request ID before Pino HTTP logging',
        );
      }

      return requestId;
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
  response: ServerResponse,
): SerializedResponse {
  return {
    statusCode: response.statusCode,
  };
}

function stripQueryString(url: string | undefined): string {
  if (!url) {
    return '/';
  }

  const queryIndex = url.indexOf('?');

  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

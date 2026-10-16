import { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { resolve } from 'node:path';

import { REQUEST_ID_HEADER } from '@platform/http/http.constants';

const requireFromHere = createRequire(__filename);
const prettyTransport = requireFromHere('./pino-pretty.transport.cjs') as {
  formatMessage: (
    log: Record<string, unknown>,
    messageKey: string,
    levelLabel: string,
    colors: {
      colors: {
        bold: (text: string) => string;
        cyan: (text: string) => string;
        white: (text: string) => string;
      };
    },
  ) => string;
};

import {
  createPinoHttpOptions,
  serializeRequest,
  serializeResponse,
} from './logging.options';

describe('Pino HTTP logging options', () => {
  it('reuses the request ID created by the request context', () => {
    const request = new IncomingMessage(new Socket());
    const response = new ServerResponse(request);

    response.setHeader(REQUEST_ID_HEADER, 'request-123');

    const options = createPinoHttpOptions('info');

    expect(options.genReqId(request, response)).toBe('request-123');
  });

  /** It creates and publishes a request ID when logging runs before request context setup. */
  it('creates a request ID when request context has not set one yet', () => {
    const request = new IncomingMessage(new Socket());
    const response = new ServerResponse(request);
    const options = createPinoHttpOptions('info');

    const requestId = options.genReqId(request, response);

    expect(requestId).toEqual(expect.any(String));
    expect(response.getHeader(REQUEST_ID_HEADER)).toBe(requestId);
  });

  it('serializes only safe request fields and removes query parameters', () => {
    const request = new IncomingMessage(new Socket());

    request.id = 'request-123';
    request.method = 'GET';
    request.url = '/api/v1/assets?token=secret';
    request.headers.authorization = 'Bearer secret';

    expect(serializeRequest(request)).toEqual({
      id: 'request-123',
      method: 'GET',
      url: '/api/v1/assets',
    });
  });

  it('serializes the response status without response headers', () => {
    const request = new IncomingMessage(new Socket());
    const response = new ServerResponse(request);

    response.statusCode = 503;
    response.setHeader('Set-Cookie', 'session=secret');

    expect(serializeResponse(response)).toEqual({
      statusCode: 503,
    });
  });

  it('logs client errors as warnings and server errors as errors', () => {
    const request = new IncomingMessage(new Socket());
    const response = new ServerResponse(request);
    const options = createPinoHttpOptions('info');

    response.statusCode = 404;
    expect(options.customLogLevel(request, response, undefined)).toBe('warn');

    response.statusCode = 503;
    expect(options.customLogLevel(request, response, undefined)).toBe('error');
  });

  it('emits structured JSON logs to stdout', () => {
    const options = createPinoHttpOptions('info', 'production');

    expect(options).not.toHaveProperty('stream');
    expect(options).not.toHaveProperty('destination');
    expect(options.level).toBe('info');

    expect(typeof options.serializers?.req).toBe('function');
    expect(typeof options.serializers?.res).toBe('function');
  });

  /** It formats development logs with readable timestamps and ANSI colors. */
  it('uses colored pretty output in development', () => {
    const options = createPinoHttpOptions('info', 'development');
    const transport = options.transport as {
      target: string;
      options: {
        colorize: boolean;
        ignore: string;
        singleLine?: boolean;
        translateTime: string;
      };
    };

    expect(transport.target).toBe(
      resolve(
        process.cwd(),
        'src/platform/observability/logging/pino-pretty.transport.cjs',
      ),
    );
    expect(transport.options).toMatchObject({
      colorize: true,
      ignore: 'pid,hostname,context',
      singleLine: true,
      translateTime: 'SYS:HH:MM:ss',
    });
  });

  /** It prints each Nest context inline with its message instead of on a second line. */
  it('formats the context and message on one readable line', () => {
    const message = prettyTransport.formatMessage(
      { context: 'RouterExplorer', msg: 'Mapped {/api/v1/users, POST} route' },
      'msg',
      'INFO',
      {
        colors: {
          bold: (value) => `<bold>${value}</bold>`,
          cyan: (value) => `<cyan>${value}</cyan>`,
          white: (value) => `<white>${value}</white>`,
        },
      },
    );

    expect(message).toBe(
      '<bold><cyan>RouterExplorer</cyan></bold> | <white>Mapped {/api/v1/users, POST} route</white>',
    );
  });

  /** It writes concise request lines with the method, sanitized URL, status, and duration. */
  it('formats successful HTTP requests in one line', () => {
    const request = new IncomingMessage(new Socket());
    const response = new ServerResponse(request);
    const options = createPinoHttpOptions('info', 'development');
    const customSuccessMessage = options.customSuccessMessage as (
      request: IncomingMessage,
      response: ServerResponse,
      responseTime: number,
    ) => string;

    request.method = 'POST';
    request.url = '/api/v1/auth/logout?session=secret';
    response.statusCode = 204;

    expect(customSuccessMessage(request, response, 12.4)).toBe(
      'POST /api/v1/auth/logout -> 204 (12 ms)',
    );
  });

  /** It retains machine-readable JSON output outside development. */
  it('keeps pretty output disabled in production', () => {
    const options = createPinoHttpOptions('info', 'production');

    expect(options).not.toHaveProperty('transport');
  });
});

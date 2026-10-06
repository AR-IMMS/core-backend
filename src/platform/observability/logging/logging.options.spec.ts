import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

import { REQUEST_ID_HEADER } from '@platform/http/http.constants';

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
    const options = createPinoHttpOptions('info');

    expect(options).not.toHaveProperty('stream');
    expect(options).not.toHaveProperty('destination');
    expect(options.level).toBe('info');

    expect(typeof options.serializers?.req).toBe('function');
    expect(typeof options.serializers?.res).toBe('function');
  });
});

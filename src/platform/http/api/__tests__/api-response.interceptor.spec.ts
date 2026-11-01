import { describe, expect, it, jest } from '@jest/globals';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';

import { ApiResponseInterceptor } from '../api-response.interceptor';

describe('ApiResponseInterceptor', () => {
  it('logs sanitized response envelopes only when debug logging is enabled', async () => {
    const debug = jest.fn();
    const logger = {
      debug,
      logger: { isLevelEnabled: jest.fn(() => true) },
    };
    const cls = { getId: jest.fn(() => 'request-123') };
    const interceptor = new ApiResponseInterceptor(
      { getAllAndOverride: jest.fn(() => false) } as unknown as Reflector,
      cls as never,
      logger as never,
    );

    const context = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getResponse: () => ({ statusCode: 201 }) }),
    } as unknown as ExecutionContext;
    const next = {
      handle: () =>
        of({
          access_token: 'access-secret',
          refresh_token: 'refresh-secret',
          token_type: 'Bearer',
          expires_in: 900,
        }),
    } as CallHandler;

    await lastValueFrom(interceptor.intercept(context, next));

    expect(debug).toHaveBeenCalledWith(
      {
        requestId: 'request-123',
        statusCode: 201,
        response: {
          data: {
            access_token: '[REDACTED]',
            refresh_token: '[REDACTED]',
            token_type: 'Bearer',
            expires_in: 900,
          },
          meta: { request_id: 'request-123' },
        },
      },
      'HTTP response body',
    );
  });

  it('does not build or log response details when debug logging is disabled', async () => {
    const debug = jest.fn();
    const logger = {
      debug,
      logger: { isLevelEnabled: jest.fn(() => false) },
    };
    const interceptor = new ApiResponseInterceptor(
      { getAllAndOverride: jest.fn(() => false) } as unknown as Reflector,
      { getId: jest.fn(() => 'request-123') } as never,
      logger as never,
    );

    const context = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getResponse: () => ({ statusCode: 200 }) }),
    } as unknown as ExecutionContext;

    await lastValueFrom(
      interceptor.intercept(context, { handle: () => of({ ok: true }) }),
    );

    expect(logger.logger.isLevelEnabled).toHaveBeenCalledWith('debug');
    expect(debug).not.toHaveBeenCalled();
  });
});

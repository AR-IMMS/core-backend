import { createHmac } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  InvalidCredentialsError,
  type AuthService,
} from '../application/auth.service';
import { BrowserAuthController } from './browser-auth.controller';
import type { BrowserAuthConfig } from './browser-auth-config.token';

describe('BrowserAuthController', () => {
  const currentRefresh = 'opaque-refresh-token-value-1234567890';
  const nextRefresh = 'rotated-refresh-token-value-1234567890';
  /** It returns only the access credential, sets a protected refresh cookie, and binds CSRF to that refresh token. */
  test('logs in through the cookie transport without returning the refresh token', async () => {
    const auth = {
      checkLoginRateLimit: jest.fn(),
      login: jest.fn().mockResolvedValue(tokenSet(currentRefresh)),
    };
    const controller = new BrowserAuthController(
      auth as unknown as AuthService,
      makeConfig(),
    );
    const cookie = jest.fn();
    const setHeader = jest.fn();
    const response = makeResponse({ cookie, setHeader });

    const result = await controller.login(
      makeRequest({
        body: { identifier: 'admin', password: 'secret' },
        origin: 'https://dashboard.example.test',
      }),
      response,
    );

    expect(result).toMatchObject({
      access_token: 'access.jwt',
      token_type: 'Bearer',
    });
    expect(result).not.toHaveProperty('refresh_token');
    expect(cookie).toHaveBeenCalledWith(
      '__Secure-arimms_refresh',
      currentRefresh,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/api/v1/auth/browser',
      }),
    );
    expect(result.csrf_token).toBe(csrfFor(currentRefresh));
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  /** It logs only a fixed failure event and keeps the account and password out of security telemetry. */
  test('records sanitized telemetry for failed browser login', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const auth = {
      checkLoginRateLimit: jest.fn(),
      login: jest.fn().mockRejectedValue(new InvalidCredentialsError()),
    };
    const controller = new BrowserAuthController(
      auth as unknown as AuthService,
      makeConfig(),
    );

    await expect(
      controller.login(
        makeRequest({
          body: { identifier: 'sensitive-account', password: 'secret-value' },
          origin: 'https://dashboard.example.test',
        }),
        makeResponse(),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(warn).toHaveBeenCalledWith('iam.auth.login.failed');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-value');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive-account');
    warn.mockRestore();
  });

  /** It rejects cookie-authenticated mutations when either Origin or the session-bound CSRF token is invalid. */
  test.each([
    {
      origin: 'https://attacker.example.test',
      csrf: csrfFor(currentRefresh),
    },
    { origin: 'https://dashboard.example.test', csrf: 'wrong-token' },
  ])(
    'rejects invalid browser request origin or CSRF proof',
    async ({ origin, csrf }) => {
      const auth = { refresh: jest.fn() };
      const controller = new BrowserAuthController(
        auth as unknown as AuthService,
        makeConfig(),
      );

      await expect(
        controller.refresh(
          makeRequest({ origin, csrf, cookie: currentRefresh }),
          makeResponse(),
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect(auth.refresh).not.toHaveBeenCalled();
    },
  );

  /** It rotates the cookie and CSRF proof together while keeping refresh credentials out of JSON. */
  test('refreshes a browser session with the supplied CSRF token', async () => {
    const auth = {
      refresh: jest.fn().mockResolvedValue(tokenSet(nextRefresh)),
    };
    const controller = new BrowserAuthController(
      auth as unknown as AuthService,
      makeConfig(),
    );
    const cookie = jest.fn();
    const response = makeResponse({ cookie });
    const result = await controller.refresh(
      makeRequest({
        origin: 'https://dashboard.example.test',
        csrf: csrfFor(currentRefresh),
        cookie: currentRefresh,
      }),
      response,
    );

    expect(auth.refresh).toHaveBeenCalledWith(currentRefresh, '192.0.2.4');
    expect(result).not.toHaveProperty('refresh_token');
    expect(result.csrf_token).toBe(csrfFor(nextRefresh));
    expect(cookie).toHaveBeenCalledWith(
      '__Secure-arimms_refresh',
      nextRefresh,
      expect.any(Object),
    );
  });

  /** It revokes the session and expires the scoped refresh cookie on browser logout. */
  test('logs out a browser session and clears its cookie', async () => {
    const auth = { logoutByRefreshToken: jest.fn() };
    const clearCookie = jest.fn();
    const response = makeResponse({ clearCookie });
    const controller = new BrowserAuthController(
      auth as unknown as AuthService,
      makeConfig(),
    );

    await controller.logout(
      makeRequest({
        origin: 'https://dashboard.example.test',
        csrf: csrfFor(currentRefresh),
        cookie: currentRefresh,
      }),
      response,
    );

    expect(auth.logoutByRefreshToken).toHaveBeenCalledWith(currentRefresh);
    expect(clearCookie).toHaveBeenCalledWith(
      '__Secure-arimms_refresh',
      expect.objectContaining({
        secure: true,
        httpOnly: true,
        path: '/api/v1/auth/browser',
      }),
    );
  });
});

function makeConfig(): BrowserAuthConfig {
  return {
    allowedOrigins: ['https://dashboard.example.test'],
    csrfSecret: 'test-csrf-secret-with-at-least-32-characters',
    cookieSameSite: 'lax',
  };
}

function makeRequest(input: {
  readonly body?: unknown;
  readonly origin: string;
  readonly csrf?: string;
  readonly cookie?: string;
}): Request {
  const headers: Record<string, string> = { origin: input.origin };
  if (input.csrf) headers['x-csrf-token'] = input.csrf;
  if (input.cookie) headers.cookie = `__Secure-arimms_refresh=${input.cookie}`;
  return {
    body: input.body,
    ip: '192.0.2.4',
    headers,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function makeResponse(
  overrides: {
    readonly cookie?: Response['cookie'];
    readonly setHeader?: Response['setHeader'];
    readonly clearCookie?: Response['clearCookie'];
  } = {},
): Response {
  return {
    setHeader: overrides.setHeader ?? jest.fn(),
    cookie: overrides.cookie ?? jest.fn(),
    clearCookie: overrides.clearCookie ?? jest.fn(),
  } as unknown as Response;
}

function tokenSet(refreshToken: string) {
  return {
    accessToken: 'access.jwt',
    refreshToken,
    tokenType: 'Bearer' as const,
    expiresIn: 900,
    refreshExpiresAt: new Date('2026-10-22T12:00:00Z'),
    mustChangePassword: false,
  };
}

function csrfFor(refreshToken: string): string {
  return createHmac('sha256', 'test-csrf-secret-with-at-least-32-characters')
    .update(refreshToken)
    .digest('base64url');
}

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import type {
  AccessTokenVerifierPort,
  HumanSessionAccessPort,
} from '../application/ports/human-session-access.port';
import { HumanAccessGuard } from './human-access.guard';

describe('HumanAccessGuard', () => {
  /** It attaches a principal only after token and active-session verification. */
  test('attaches the verified principal and session to the request', async () => {
    const principal = {
      userId: 'u-1',
      role: 'OPERATOR' as const,
      status: 'ACTIVE' as const,
      sessionId: 's-1',
      mustChangePassword: false,
    };
    const verifier: AccessTokenVerifierPort = {
      verifyAccessToken: jest
        .fn()
        .mockResolvedValue({ userId: 'u-1', sessionId: 's-1' }),
    };
    const sessions: HumanSessionAccessPort = {
      getActivePrincipal: jest.fn().mockResolvedValue(principal),
    };
    const guard = new HumanAccessGuard(verifier, sessions);
    const request = { headers: { authorization: 'Bearer valid-token' } };
    const context = createContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request).toHaveProperty('user', principal);
    expect(sessions.getActivePrincipal).toHaveBeenCalledWith(
      'u-1',
      's-1',
      expect.any(Date),
    );
  });

  /** It accepts access tokens containing the letter s as normal JWT strings do. */
  test('passes a normal token through bearer parsing', async () => {
    const verifier: AccessTokenVerifierPort = {
      verifyAccessToken: jest
        .fn()
        .mockResolvedValue({ userId: 'u-1', sessionId: 's-1' }),
    };
    const sessions: HumanSessionAccessPort = {
      getActivePrincipal: jest.fn().mockResolvedValue({
        userId: 'u-1',
        role: 'OPERATOR',
        status: 'ACTIVE',
        sessionId: 's-1',
        mustChangePassword: false,
      }),
    };
    const guard = new HumanAccessGuard(verifier, sessions);
    const context = createContext({
      headers: { authorization: 'Bearer access-token' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jest.mocked(verifier.verifyAccessToken)).toHaveBeenCalledWith(
      'access-token',
    );
  });

  /** It blocks an initial-password user from protected routes other than the change flow. */
  test('allows only first-password change and logout while rotation is required', async () => {
    const verifier: AccessTokenVerifierPort = {
      verifyAccessToken: jest
        .fn()
        .mockResolvedValue({ userId: 'u-1', sessionId: 's-1' }),
    };
    const sessions: HumanSessionAccessPort = {
      getActivePrincipal: jest.fn().mockResolvedValue({
        userId: 'u-1',
        role: 'OPERATOR',
        status: 'ACTIVE',
        sessionId: 's-1',
        mustChangePassword: true,
      }),
    };
    const guard = new HumanAccessGuard(verifier, sessions);
    const blocked = createContext({
      headers: { authorization: 'Bearer valid-token' },
      baseUrl: '/api/v1/auth',
      route: { path: '/me' },
    });
    await expect(guard.canActivate(blocked)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const allowed = createContext({
      headers: { authorization: 'Bearer valid-token' },
      baseUrl: '/api/v1/auth',
      route: { path: '/change-password' },
    });
    await expect(guard.canActivate(allowed)).resolves.toBe(true);
  });

  /** It rejects missing, malformed, invalid, or revoked bearer sessions. */
  test.each([
    [undefined, null],
    ['Basic bad', null],
    ['Bearer invalid', null],
  ])('rejects authorization header %s', async (authorization, claims) => {
    const verifier: AccessTokenVerifierPort = {
      verifyAccessToken: jest.fn().mockResolvedValue(claims),
    };
    const sessions: HumanSessionAccessPort = {
      getActivePrincipal: jest.fn().mockResolvedValue(null),
    };
    const guard = new HumanAccessGuard(verifier, sessions);
    const context = createContext({ headers: { authorization } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

function createContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

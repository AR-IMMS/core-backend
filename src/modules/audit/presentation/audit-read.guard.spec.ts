import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { AuditReadGuard } from './audit-read.guard';

function contextFor(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AuditReadGuard', () => {
  /** It requires a trusted authenticated principal before evaluating permissions. */
  test('rejects a request without a principal', () => {
    expect(() =>
      new AuditReadGuard().canActivate(contextFor(undefined)),
    ).toThrow(UnauthorizedException);
  });

  /** It denies authenticated principals that lack audit:read. */
  test('rejects a principal without audit:read', () => {
    expect(() =>
      new AuditReadGuard().canActivate(
        contextFor({ permissions: ['user:read'] }),
      ),
    ).toThrow(ForbiddenException);
  });

  /** It allows an authenticated principal with audit:read. */
  test('allows a principal with audit:read', () => {
    expect(
      new AuditReadGuard().canActivate(
        contextFor({ permissions: ['audit:read'] }),
      ),
    ).toBe(true);
  });
});

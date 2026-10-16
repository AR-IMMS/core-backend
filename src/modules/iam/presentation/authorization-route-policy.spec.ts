import { Reflector } from '@nestjs/core';

jest.mock('@nestjs/terminus', () => ({
  HealthCheck: () => () => undefined,
}));
jest.mock('@platform/health/application/health-readiness.service', () => ({
  HealthReadinessService: class HealthReadinessService {},
}));

import { AuditController } from '@modules/audit/presentation/audit.controller';
import { HealthController } from '@platform/health/presentation/health.controller';
import { AuthController } from './auth.controller';
import { BrowserAuthController } from './browser-auth.controller';
import { CurrentUserController } from './current-user.controller';
import { UsersController } from './users.controller';
import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api';

describe('HTTP route policy assignments', () => {
  /** Marks all public authentication entry flows and health probes explicitly. */
  it('marks native login and refresh, browser auth, and health as public', () => {
    expect(policy(AuthController, 'login')).toEqual({ kind: 'public' });
    expect(policy(AuthController, 'refresh')).toEqual({ kind: 'public' });
    expect(policy(BrowserAuthController)).toEqual({ kind: 'public' });
    expect(policy(HealthController, 'live')).toEqual({ kind: 'public' });
    expect(policy(HealthController, 'ready')).toEqual({ kind: 'public' });
  });

  /** Requires active sessions for native session and current-user endpoints. */
  it('requires authentication for session and current-user operations', () => {
    expect(policy(AuthController, 'logout')).toEqual({ kind: 'authenticated' });
    expect(policy(AuthController, 'changePassword')).toEqual({
      kind: 'authenticated',
    });
    expect(policy(CurrentUserController)).toEqual({ kind: 'authenticated' });
  });

  /** Assigns admin and Audit capabilities to their owning module routes. */
  it('requires the owning module capability for administration and Audit', () => {
    expect(policy(UsersController, 'create')).toEqual({
      kind: 'permissions',
      permissions: ['user:manage'],
    });
    expect(policy(AuditController)).toEqual({
      kind: 'permissions',
      permissions: ['audit:read'],
    });
  });
});

function policy(
  controller: { readonly prototype: object },
  handlerName?: string,
): unknown {
  const handler = handlerName
    ? getHandler(controller.prototype, handlerName)
    : undefined;
  return new Reflector().getAllAndOverride(
    HTTP_ROUTE_POLICY_METADATA,
    handler ? [handler, controller] : [controller],
  );
}

function getHandler(target: object, propertyKey: string): object {
  const value: unknown = Object.getOwnPropertyDescriptor(
    target,
    propertyKey,
  )?.value;
  if (typeof value !== 'function')
    throw new Error('Controller handler is missing');
  return value;
}

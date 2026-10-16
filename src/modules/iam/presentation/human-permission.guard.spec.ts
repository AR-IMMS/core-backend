import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  HTTP_ROUTE_POLICY_METADATA,
  type HttpRoutePolicy,
} from '@platform/http/api';
import { HumanPermissionGuard } from './human-permission.guard';

describe('HumanPermissionGuard', () => {
  /** Fails closed when a route has no explicit authorization policy. */
  it('denies routes without policy metadata', () => {
    const guard = new HumanPermissionGuard(new Reflector(), {
      isKnownPermissionCode: () => true,
    });

    expect(() => guard.canActivate(createContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  /** Allows an explicitly public route without a current human principal. */
  it('allows explicitly public routes', () => {
    const guard = new HumanPermissionGuard(new Reflector(), {
      isKnownPermissionCode: () => true,
    });

    expect(guard.canActivate(createContext({ kind: 'public' }))).toBe(true);
  });

  /** Requires the authentication guard to attach an active principal first. */
  it('requires an active principal for authenticated-only routes', () => {
    const guard = new HumanPermissionGuard(new Reflector(), {
      isKnownPermissionCode: () => true,
    });

    expect(() =>
      guard.canActivate(createContext({ kind: 'authenticated' })),
    ).toThrow(UnauthorizedException);
    expect(
      guard.canActivate(
        createContext(
          { kind: 'authenticated' },
          {
            userId: 'u-1',
            role: 'OPERATOR',
            status: 'ACTIVE',
            effectivePermissions: [],
          },
        ),
      ),
    ).toBe(true);
  });

  /** Requires all permissions from the current principal and rejects invalid policy. */
  it('enforces all-of permission policy and rejects unknown codes', () => {
    const guard = new HumanPermissionGuard(new Reflector(), {
      isKnownPermissionCode: (code) => code !== 'agent:manage',
    });
    const permitted = createContext(
      { kind: 'permissions', permissions: ['audit:read'] },
      {
        userId: 'u-1',
        role: 'IT_ADMIN',
        status: 'ACTIVE',
        effectivePermissions: ['audit:read'],
      },
    );
    const missing = createContext(
      { kind: 'permissions', permissions: ['audit:read', 'user:read'] },
      {
        userId: 'u-1',
        role: 'OPERATOR',
        status: 'ACTIVE',
        effectivePermissions: ['audit:read'],
      },
    );
    const unknown = createContext(
      { kind: 'permissions', permissions: ['agent:manage'] },
      {
        userId: 'u-1',
        role: 'IT_ADMIN',
        status: 'ACTIVE',
        effectivePermissions: ['audit:read'],
      },
    );

    expect(guard.canActivate(permitted)).toBe(true);
    expect(() => guard.canActivate(missing)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(unknown)).toThrow(ForbiddenException);
  });
});

function createContext(
  policy: HttpRoutePolicy | undefined,
  user?: {
    readonly userId: string;
    readonly role: 'IT_ADMIN' | 'OPERATOR' | 'TECHNICIAN';
    readonly status: 'ACTIVE' | 'INACTIVE';
    readonly effectivePermissions: readonly string[];
  },
): ExecutionContext {
  class TestController {
    endpoint() {}
  }
  const handler = Object.getOwnPropertyDescriptor(
    TestController.prototype,
    'endpoint',
  )?.value as object;
  if (policy)
    Reflect.defineMetadata(HTTP_ROUTE_POLICY_METADATA, policy, handler);
  const request = { user };
  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

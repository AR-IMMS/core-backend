import { createParamDecorator, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { defineHttpRoutePolicy } from '@platform/http/api';
import type { AuthenticatedHumanPrincipal } from '../application/ports/human-session-access.port';
import type { PermissionCode } from '../domain/role-permissions';

/** Requires a verified active human session without a capability requirement. */
export function AuthenticatedOnly(): ClassDecorator & MethodDecorator {
  return defineHttpRoutePolicy({ kind: 'authenticated' });
}

/** Requires every listed fixed IAM capability on the current principal. */
export function RequirePermissions(
  ...permissions: readonly PermissionCode[]
): ClassDecorator & MethodDecorator {
  if (permissions.length === 0) {
    throw new Error('@RequirePermissions requires at least one permission');
  }
  return defineHttpRoutePolicy({ kind: 'permissions', permissions });
}

/** Narrow handler context exposed to modules consuming the IAM HTTP contract. */
export interface AuthenticatedHumanContext {
  readonly userId: string;
  readonly role: AuthenticatedHumanPrincipal['role'];
  readonly status: AuthenticatedHumanPrincipal['status'];
  readonly effectivePermissions: AuthenticatedHumanPrincipal['effectivePermissions'];
}

/** Reads only the minimal verified IAM context from the current request. */
export const CurrentHumanPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedHumanContext => {
    const request = context.switchToHttp().getRequest<{
      readonly user?: AuthenticatedHumanPrincipal;
    }>();
    const principal = request.user;
    if (!principal) {
      throw new UnauthorizedException();
    }

    return {
      userId: principal.userId,
      role: principal.role,
      status: principal.status,
      effectivePermissions: principal.effectivePermissions,
    };
  },
);

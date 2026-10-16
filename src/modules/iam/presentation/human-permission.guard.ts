import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  HTTP_ROUTE_POLICY_METADATA,
  type HttpRoutePolicy,
} from '@platform/http/api';
import type { PermissionCatalogPort } from '../application/ports/permission-catalog.port';
import { IAM_PERMISSION_CATALOG_PORT } from '../application/ports/permission-catalog.token';
import type { AuthenticatedHumanPrincipal } from '../application/ports/human-session-access.port';

interface HumanPermissionRequest {
  readonly user?: AuthenticatedHumanPrincipal;
}

/** Enforces the explicit IAM capability policy after human authentication. */
@Injectable()
export class HumanPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IAM_PERMISSION_CATALOG_PORT)
    private readonly permissionCatalog: PermissionCatalogPort,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<HttpRoutePolicy>(
      HTTP_ROUTE_POLICY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (policy?.kind === 'public') return true;
    const request = context.switchToHttp().getRequest<HumanPermissionRequest>();
    if (policy?.kind === 'authenticated') {
      if (!request.user || request.user.status !== 'ACTIVE') {
        throw new UnauthorizedException();
      }
      return true;
    }
    if (
      policy?.kind !== 'permissions' ||
      !isPermissionList(policy.permissions) ||
      policy.permissions.length === 0 ||
      !policy.permissions.every(
        (permission) =>
          typeof permission === 'string' &&
          this.permissionCatalog.isKnownPermissionCode(permission),
      )
    ) {
      throw new ForbiddenException(
        'HTTP route authorization policy is missing or invalid',
      );
    }

    const principal = request.user;
    if (!principal || principal.status !== 'ACTIVE') {
      throw new ForbiddenException();
    }
    const effectivePermissions = new Set<string>(
      principal.effectivePermissions,
    );
    if (
      !policy.permissions.every((permission) =>
        effectivePermissions.has(permission),
      )
    ) {
      throw new ForbiddenException();
    }
    return true;
  }
}

function isPermissionList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((permission) => typeof permission === 'string')
  );
}

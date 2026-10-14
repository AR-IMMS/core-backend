import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';

interface AuthenticatedAuditRequest {
  readonly user?: { readonly permissions?: unknown };
}

/** Restricts Audit reads to authenticated principals with audit:read. */
@Injectable()
export class AuditReadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedAuditRequest>();
    const user = request.user;
    if (!user) throw new UnauthorizedException();
    if (
      !Array.isArray(user.permissions) ||
      !user.permissions.includes('audit:read')
    ) {
      throw new ForbiddenException();
    }
    return true;
  }
}

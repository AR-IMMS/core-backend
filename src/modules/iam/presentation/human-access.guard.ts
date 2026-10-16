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

import type {
  AccessTokenVerifierPort,
  AuthenticatedHumanPrincipal,
  HumanSessionAccessPort,
} from '../application/ports/human-session-access.port';
import {
  IAM_ACCESS_TOKEN_VERIFIER,
  IAM_HUMAN_SESSION_ACCESS,
} from '../application/ports/human-session-access.token';

interface HumanAccessRequest {
  readonly headers: { readonly authorization?: string };
  readonly baseUrl?: string;
  readonly path?: string;
  readonly route?: { readonly path?: string };
  user?: AuthenticatedHumanPrincipal;
}

/** Authenticates a bearer token and revalidates its user and session in IAM. */
@Injectable()
export class HumanAccessGuard implements CanActivate {
  constructor(
    @Inject(IAM_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: AccessTokenVerifierPort,
    @Inject(IAM_HUMAN_SESSION_ACCESS)
    private readonly sessionAccess: HumanSessionAccessPort,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HumanAccessRequest>();
    const policy = this.reflector.getAllAndOverride<HttpRoutePolicy>(
      HTTP_ROUTE_POLICY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (policy?.kind === 'public') return true;

    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException();

    const claims = await this.tokenVerifier.verifyAccessToken(token);
    if (!claims) throw new UnauthorizedException();

    const principal = await this.sessionAccess.getActivePrincipal(
      claims.userId,
      claims.sessionId,
      new Date(),
    );
    if (!principal) throw new UnauthorizedException();

    if (
      principal.mustChangePassword &&
      !canUseBeforeInitialPasswordChange(request)
    ) {
      throw new ForbiddenException('Password change is required');
    }

    request.user = principal;
    return true;
  }
}

function canUseBeforeInitialPasswordChange(
  request: HumanAccessRequest,
): boolean {
  const path =
    `${request.baseUrl ?? ''}${request.route?.path ?? request.path ?? ''}`
      .split('?')[0]
      ?.replace(/\/$/, '');
  return (
    path?.endsWith('/auth/change-password') === true ||
    path?.endsWith('/auth/logout') === true
  );
}

function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer (\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

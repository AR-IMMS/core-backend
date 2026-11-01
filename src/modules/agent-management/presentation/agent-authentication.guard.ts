import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type {
  AgentAccessPersistencePort,
  AgentPrincipal,
} from '../application/agent-access.port';
import { AGENT_ACCESS_PERSISTENCE_PORT } from '../application/agent-access.port';

interface AgentAuthenticationRequest {
  readonly headers: { readonly authorization?: string };
  agentPrincipal?: AgentPrincipal;
}

/** Authenticates Core Agent-facing requests using an active opaque credential. */
@Injectable()
export class AgentAuthenticationGuard implements CanActivate {
  constructor(
    @Inject(AGENT_ACCESS_PERSISTENCE_PORT)
    private readonly access: AgentAccessPersistencePort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AgentAuthenticationRequest>();
    const credential = bearerCredential(request.headers.authorization);
    if (!credential) throw invalidCredential();

    let principal: AgentPrincipal | null;
    try {
      principal = await this.access.findActivePrincipalByCredentialHash(
        createHash('sha256').update(credential).digest('hex'),
      );
    } catch {
      throw new ServiceUnavailableException({
        code: 'AGENT_AUTHENTICATION_UNAVAILABLE',
      });
    }
    if (!principal) throw invalidCredential();

    request.agentPrincipal = principal;
    return true;
  }
}

function bearerCredential(value: string | undefined): string | null {
  if (!value || value.length > 520) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

function invalidCredential(): UnauthorizedException {
  return new UnauthorizedException({ code: 'INVALID_AGENT_CREDENTIAL' });
}

import type { UnitOfWorkContext } from '@platform/events';

export interface AgentPrincipal {
  readonly installationId: string;
  readonly bindingId: string;
  readonly nodeId: string;
}

export type BindingRevocationResult =
  'revoked' | 'already-revoked' | 'not-found';

/** Persistence boundary for Agent authentication and binding revocation. */
export interface AgentAccessPersistencePort {
  findActivePrincipalByCredentialHash(
    credentialHash: string,
  ): Promise<AgentPrincipal | null>;
  revokeBinding(
    bindingId: string,
    actorId: string,
    revokedAt: Date,
    context: UnitOfWorkContext,
  ): Promise<BindingRevocationResult>;
}

export const AGENT_ACCESS_PERSISTENCE_PORT = Symbol(
  'AGENT_ACCESS_PERSISTENCE_PORT',
);

export class AgentBindingNotFoundError extends Error {}
export class AgentBindingRevocationUnavailableError extends Error {}

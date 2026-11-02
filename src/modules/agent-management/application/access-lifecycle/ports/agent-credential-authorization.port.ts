export interface AgentPrincipal {
  readonly installationId: string;
  readonly bindingId: string;
  readonly nodeId: string;
}

/** Resolves a trusted Agent principal from an active credential hash. */
export interface AgentCredentialAuthorizationPort {
  findActivePrincipalByCredentialHash(
    credentialHash: string,
  ): Promise<AgentPrincipal | null>;
}

export const AGENT_CREDENTIAL_AUTHORIZATION_PORT = Symbol(
  'AGENT_CREDENTIAL_AUTHORIZATION_PORT',
);

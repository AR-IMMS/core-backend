import type { UnitOfWorkContext } from '@platform/events';

/** Read-only Agent binding status exposed to Asset & Topology. */
export interface AgentBindingQueries {
  hasActiveBindingForNode(
    nodeId: string,
    context: UnitOfWorkContext,
  ): Promise<boolean>;
  hasActiveFleetBindingForNode(
    nodeId: string,
    actor: { readonly actorId: string; readonly requestId: string },
  ): Promise<boolean>;
}

/** Safe cross-module failure when Fleet's authoritative binding state is unavailable. */
export class AgentFleetBindingStatusUnavailableError extends Error {
  constructor() {
    super('Fleet binding status is temporarily unavailable');
    this.name = 'AgentFleetBindingStatusUnavailableError';
  }
}

export const AGENT_BINDING_QUERIES_PORT = Symbol('AGENT_BINDING_QUERIES_PORT');

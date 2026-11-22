import type { UnitOfWorkContext } from '@platform/events';

/** Read-only Agent binding status exposed to Asset & Topology. */
export interface AgentBindingQueries {
  hasActiveBindingForNode(
    nodeId: string,
    context: UnitOfWorkContext,
  ): Promise<boolean>;
}

export const AGENT_BINDING_QUERIES_PORT = Symbol('AGENT_BINDING_QUERIES_PORT');

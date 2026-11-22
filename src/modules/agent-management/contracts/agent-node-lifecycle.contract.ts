export interface AgentNodeEnrollmentGate {
  readonly nodeId: string;
  readonly operationId: string;
  readonly version: number;
  readonly previousState: 'OPEN' | 'CLOSED';
  readonly activeBinding: {
    readonly installationId: string;
    readonly bindingId: string;
  } | null;
}

export interface AgentNodeLifecycleActor {
  readonly actorId: string;
  readonly requestId: string;
}

/** Narrow Core-to-Fleet coordination exposed to Asset & Topology. */
export interface AgentNodeLifecycleCoordination {
  closeEnrollmentGate(input: {
    readonly nodeId: string;
    readonly operationId: string;
    readonly actor: AgentNodeLifecycleActor;
  }): Promise<AgentNodeEnrollmentGate>;
  completeEnrollmentGate(input: {
    readonly gate: AgentNodeEnrollmentGate;
    /** COMMIT leaves the gate closed; ABORT restores gate.previousState. */
    readonly outcome: 'COMMIT' | 'ABORT';
    readonly actor: AgentNodeLifecycleActor;
  }): Promise<void>;
}

export const AGENT_NODE_LIFECYCLE_COORDINATION_PORT = Symbol(
  'AGENT_NODE_LIFECYCLE_COORDINATION_PORT',
);

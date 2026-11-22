import type {
  FleetActorContext,
  FleetEnrollmentGate,
} from '../application/fleet/fleet.types';

/** Narrow Core-to-Fleet coordination exposed to Asset & Topology. */
export interface AgentNodeLifecycleCoordination {
  closeEnrollmentGate(input: {
    readonly nodeId: string;
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetEnrollmentGate>;
  completeEnrollmentGate(input: {
    readonly gate: FleetEnrollmentGate;
    /** COMMIT leaves the gate closed; ABORT restores gate.previousState. */
    readonly outcome: 'COMMIT' | 'ABORT';
    readonly actor: FleetActorContext;
  }): Promise<void>;
}

export const AGENT_NODE_LIFECYCLE_COORDINATION_PORT = Symbol(
  'AGENT_NODE_LIFECYCLE_COORDINATION_PORT',
);

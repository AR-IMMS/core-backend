import type { FleetActorContext, FleetEnrollmentGate } from '../fleet.types';

export interface FleetNodeEnrollmentGatePort {
  closeEnrollmentGate(input: {
    readonly nodeId: string;
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetEnrollmentGate>;
  completeEnrollmentGate(input: {
    readonly gate: FleetEnrollmentGate;
    readonly state: 'OPEN' | 'CLOSED';
    readonly actor: FleetActorContext;
  }): Promise<void>;
}

export const FLEET_NODE_ENROLLMENT_GATE_PORT = Symbol(
  'FLEET_NODE_ENROLLMENT_GATE_PORT',
);

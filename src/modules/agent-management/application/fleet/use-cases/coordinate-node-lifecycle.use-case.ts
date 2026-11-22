import { Inject, Injectable } from '@nestjs/common';
import type { AgentNodeLifecycleCoordination } from '../../../contracts/agent-node-lifecycle.contract';
import { FLEET_NODE_ENROLLMENT_GATE_PORT } from '../ports/fleet-node-enrollment-gate.port';
import type { FleetNodeEnrollmentGatePort } from '../ports/fleet-node-enrollment-gate.port';
import type { FleetActorContext, FleetEnrollmentGate } from '../fleet.types';

/** Keeps Fleet gate operations behind the Agent Management public contract. */
@Injectable()
export class CoordinateNodeLifecycleUseCase implements AgentNodeLifecycleCoordination {
  constructor(
    @Inject(FLEET_NODE_ENROLLMENT_GATE_PORT)
    private readonly gate: FleetNodeEnrollmentGatePort,
  ) {}

  closeEnrollmentGate(input: {
    readonly nodeId: string;
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetEnrollmentGate> {
    return this.gate.closeEnrollmentGate(input);
  }

  completeEnrollmentGate(input: {
    readonly gate: FleetEnrollmentGate;
    readonly outcome: 'COMMIT' | 'ABORT';
    readonly actor: FleetActorContext;
  }): Promise<void> {
    return this.gate.completeEnrollmentGate({
      gate: input.gate,
      state: input.outcome === 'COMMIT' ? 'CLOSED' : input.gate.previousState,
      actor: input.actor,
    });
  }
}

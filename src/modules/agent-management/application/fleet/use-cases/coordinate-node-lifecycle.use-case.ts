import { Inject, Injectable } from '@nestjs/common';
import type { AgentNodeLifecycleCoordination } from '../../../contracts/agent-node-lifecycle.contract';
import { FLEET_INSTALLATION_PORT } from '../ports/fleet-installation.port';
import type { FleetInstallationPort } from '../ports/fleet-installation.port';
import type { FleetActorContext, FleetEnrollmentGate } from '../fleet.types';

/** Keeps Fleet gate operations behind the Agent Management public contract. */
@Injectable()
export class CoordinateNodeLifecycleUseCase implements AgentNodeLifecycleCoordination {
  constructor(
    @Inject(FLEET_INSTALLATION_PORT)
    private readonly installations: FleetInstallationPort,
  ) {}

  closeEnrollmentGate(input: {
    readonly nodeId: string;
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetEnrollmentGate> {
    return this.installations.closeEnrollmentGate(input);
  }

  completeEnrollmentGate(input: {
    readonly gate: FleetEnrollmentGate;
    readonly outcome: 'COMMIT' | 'ABORT';
    readonly actor: FleetActorContext;
  }): Promise<void> {
    return this.installations.completeEnrollmentGate({
      gate: input.gate,
      state: input.outcome === 'COMMIT' ? 'CLOSED' : input.gate.previousState,
      actor: input.actor,
    });
  }
}

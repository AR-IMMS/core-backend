import { FleetUnavailableError } from '../../application/fleet/errors/fleet-errors';
import type { FleetInvitationPort } from '../../application/fleet/ports/fleet-invitation.port';
import type { FleetInstallationPort } from '../../application/fleet/ports/fleet-installation.port';
import type { FleetNodeEnrollmentGatePort } from '../../application/fleet/ports/fleet-node-enrollment-gate.port';
import type { FleetEnrollmentGate } from '../../application/fleet/fleet.types';

export class DisabledFleetInvitationPort implements FleetInvitationPort {
  create(): Promise<never> {
    return Promise.reject(new FleetUnavailableError(false));
  }
  getByOperation(): Promise<null> {
    return Promise.resolve(null);
  }
  cancel(): Promise<never> {
    return Promise.reject(new FleetUnavailableError(false));
  }
}

export class DisabledFleetInstallationPort implements FleetInstallationPort {
  findById(): Promise<null> {
    return Promise.resolve(null);
  }
  findActiveByNode(): Promise<null> {
    // With the Fleet endpoint unset, this deployment remains in legacy-only
    // mode; configured-but-unavailable Fleet still fails closed in the client.
    return Promise.resolve(null);
  }
}

/** Explicit legacy-only mode: no Fleet cohort exists, so gate calls are no-ops. */
export class DisabledFleetNodeEnrollmentGatePort implements FleetNodeEnrollmentGatePort {
  closeEnrollmentGate(input: {
    readonly nodeId: string;
    readonly operationId: string;
  }): Promise<FleetEnrollmentGate> {
    return Promise.resolve({
      nodeId: input.nodeId,
      operationId: input.operationId,
      version: 0,
      previousState: 'OPEN',
      activeBinding: null,
    });
  }
  completeEnrollmentGate(): Promise<void> {
    return Promise.resolve();
  }
}

import { FleetUnavailableError } from '../../application/fleet/errors/fleet-errors';
import type { FleetInvitationPort } from '../../application/fleet/ports/fleet-invitation.port';
import type { FleetInstallationPort } from '../../application/fleet/ports/fleet-installation.port';

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
  closeEnrollmentGate(): Promise<never> {
    return Promise.reject(new FleetUnavailableError(false));
  }
  completeEnrollmentGate(): Promise<never> {
    return Promise.reject(new FleetUnavailableError(false));
  }
  revoke(): Promise<never> {
    return Promise.reject(new FleetUnavailableError(false));
  }
}

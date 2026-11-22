import { FleetUnavailableError } from '../../application/fleet/errors/fleet-errors';
import type { FleetInvitationPort } from '../../application/fleet/ports/fleet-invitation.port';
import type { FleetInstallationPort } from '../../application/fleet/ports/fleet-installation.port';

export class DisabledFleetInvitationPort implements FleetInvitationPort {
  create(): Promise<never> {
    return Promise.reject(new FleetUnavailableError(false));
  }
  getByOperation(): Promise<never> {
    return Promise.reject(new FleetUnavailableError(false));
  }
  cancel(): Promise<never> {
    return Promise.reject(new FleetUnavailableError(false));
  }
}

export class DisabledFleetInstallationPort implements FleetInstallationPort {
  findById(): Promise<never> {
    return Promise.reject(new FleetUnavailableError(false));
  }
  findActiveByNode(): Promise<never> {
    return Promise.reject(new FleetUnavailableError(false));
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

export interface FleetActorContext {
  readonly actorId: string;
  readonly requestId: string;
}

export type FleetInvitationState =
  'PENDING' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED';

export interface FleetInvitationView {
  readonly invitationId: string;
  readonly operationId: string;
  readonly nodeId: string;
  readonly status: FleetInvitationState;
  readonly expiresAt: Date;
  readonly invitationToken?: string;
  readonly installationId?: string;
}

export interface FleetInstallationView {
  readonly installationId: string;
  readonly nodeId: string | null;
  readonly status: 'ACTIVE' | 'REVOKED' | 'UNKNOWN';
}

export interface FleetEnrollmentGate {
  readonly nodeId: string;
  readonly operationId: string;
  readonly version: number;
  readonly previousState: 'OPEN' | 'CLOSED';
}

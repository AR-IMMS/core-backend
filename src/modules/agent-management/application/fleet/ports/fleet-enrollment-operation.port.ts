import type { UnitOfWorkContext } from '@platform/events';
import type { FleetInvitationState } from '../fleet.types';

export type FleetEnrollmentOperationStatus =
  | 'REQUEST_PENDING'
  | 'INVITATION_ISSUED'
  | 'SYNC_PENDING'
  | 'BOUND'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REVOKED';

export interface FleetEnrollmentOperation {
  readonly operationId: string;
  readonly idempotencyHash: string;
  readonly fingerprint: string;
  readonly actorId: string;
  readonly nodeId: string;
  readonly status: FleetEnrollmentOperationStatus;
  readonly invitationId?: string;
  readonly installationId?: string;
  readonly expiresAt?: Date;
}

export interface FleetEnrollmentOperationPort {
  findByIdempotencyHash(
    idempotencyHash: string,
  ): Promise<FleetEnrollmentOperation | null>;
  findByInvitationId(
    invitationId: string,
  ): Promise<FleetEnrollmentOperation | null>;
  begin(input: {
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly fingerprint: string;
    readonly actorId: string;
    readonly nodeId: string;
    readonly createdAt: Date;
  }): Promise<{
    readonly created: boolean;
    readonly operation: FleetEnrollmentOperation;
  }>;
  recordInvitation(
    input: {
      readonly operationId: string;
      readonly invitationId: string;
      readonly status: FleetInvitationState;
      readonly installationId?: string;
      readonly expiresAt?: Date;
      readonly updatedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<boolean>;
  markBound(
    input: {
      readonly operationId: string;
      readonly installationId: string;
      readonly updatedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<void>;
}

export const FLEET_ENROLLMENT_OPERATION_PORT = Symbol(
  'FLEET_ENROLLMENT_OPERATION_PORT',
);

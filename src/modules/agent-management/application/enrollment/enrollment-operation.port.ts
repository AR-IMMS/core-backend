import type { UnitOfWorkContext } from '@platform/events';
import type { FleetInvitationState } from '../ports/fleet/fleet.types';

export type EnrollmentOperationStatus =
  | 'REQUEST_PENDING'
  | 'INVITATION_ISSUED'
  | 'SYNC_PENDING'
  | 'BOUND'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REVOKED';

export interface EnrollmentOperation {
  readonly operationId: string;
  readonly idempotencyHash: string;
  readonly fingerprint: string;
  readonly actorId: string;
  readonly nodeId: string;
  readonly status: EnrollmentOperationStatus;
  readonly invitationId?: string;
  readonly installationId?: string;
  readonly expiresAt?: Date;
}

export interface EnrollmentOperationPort {
  findByIdempotencyHash(
    idempotencyHash: string,
  ): Promise<EnrollmentOperation | null>;
  findByInvitationId(invitationId: string): Promise<EnrollmentOperation | null>;
  begin(input: {
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly fingerprint: string;
    readonly actorId: string;
    readonly nodeId: string;
    readonly createdAt: Date;
  }): Promise<{
    readonly created: boolean;
    readonly operation: EnrollmentOperation;
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

export const ENROLLMENT_OPERATION_PORT = Symbol('ENROLLMENT_OPERATION_PORT');

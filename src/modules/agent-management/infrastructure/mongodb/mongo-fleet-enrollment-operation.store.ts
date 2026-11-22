import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import {
  FleetConflictError,
  FleetUnavailableError,
} from '../../application/fleet/errors/fleet-errors';
import type {
  FleetEnrollmentOperation,
  FleetEnrollmentOperationPort,
  FleetEnrollmentOperationStatus,
} from '../../application/fleet/ports/fleet-enrollment-operation.port';
import type { FleetInvitationState } from '../../application/fleet/fleet.types';
import { fleetMongoCollection } from './fleet-mongo.types';

@Injectable()
export class MongoFleetEnrollmentOperationStore implements FleetEnrollmentOperationPort {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async findByIdempotencyHash(
    idempotencyHash: string,
  ): Promise<FleetEnrollmentOperation | null> {
    const document = await fleetMongoCollection(
      this.connection,
      'agent_management_fleet_operations',
    ).findOne({ idempotencyHash });
    return document ? parseOperation(document) : null;
  }

  async findByInvitationId(
    invitationId: string,
  ): Promise<FleetEnrollmentOperation | null> {
    const document = await fleetMongoCollection(
      this.connection,
      'agent_management_fleet_operations',
    ).findOne({ invitationId });
    return document ? parseOperation(document) : null;
  }

  async begin(input: {
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly fingerprint: string;
    readonly actorId: string;
    readonly nodeId: string;
    readonly createdAt: Date;
  }): Promise<{
    readonly created: boolean;
    readonly operation: FleetEnrollmentOperation;
  }> {
    const operations = fleetMongoCollection(
      this.connection,
      'agent_management_fleet_operations',
    );
    try {
      await operations.insertOne({
        ...input,
        status: 'REQUEST_PENDING',
        updatedAt: input.createdAt,
      });
      return {
        created: true,
        operation: {
          ...input,
          status: 'REQUEST_PENDING',
        },
      };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw new FleetUnavailableError(false);
      const existing = await operations.findOne({
        idempotencyHash: input.idempotencyHash,
      });
      if (!existing) throw new FleetUnavailableError(false);
      return { created: false, operation: parseOperation(existing) };
    }
  }

  async recordInvitation(
    input: {
      readonly operationId: string;
      readonly invitationId: string;
      readonly status: FleetInvitationState;
      readonly installationId?: string;
      readonly expiresAt: Date;
      readonly updatedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<boolean> {
    const session = context;
    const operations = fleetMongoCollection(
      this.connection,
      'agent_management_fleet_operations',
    );
    const terminalStatuses = ['BOUND', 'CANCELLED', 'EXPIRED', 'REVOKED'];
    const firstWrite = await operations.updateOne(
      {
        operationId: input.operationId,
        invitationId: { $exists: false },
        status: { $nin: terminalStatuses },
      },
      { $set: invitationFields(input) },
      { session },
    );
    if (firstWrite.matchedCount === 1) return true;

    const current = await operations.findOne(
      { operationId: input.operationId },
      { session },
    );
    if (!current) throw new FleetUnavailableError(true);
    if (terminalStatuses.includes(String(current['status']))) return false;
    if (current['invitationId'] !== input.invitationId) {
      throw new FleetConflictError('FLEET_OPERATION_INVITATION_MISMATCH');
    }

    const replayUpdate = await operations.updateOne(
      {
        operationId: input.operationId,
        invitationId: input.invitationId,
        status: { $nin: terminalStatuses },
      },
      { $set: invitationFields(input) },
      { session },
    );
    if (replayUpdate.matchedCount !== 1) {
      const latest = await operations.findOne(
        { operationId: input.operationId },
        { session },
      );
      if (!latest || !terminalStatuses.includes(String(latest['status']))) {
        throw new FleetUnavailableError(true);
      }
    }
    return false;
  }

  async markBound(
    input: {
      readonly operationId: string;
      readonly installationId: string;
      readonly updatedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<void> {
    const session = context;
    const updated = await fleetMongoCollection(
      this.connection,
      'agent_management_fleet_operations',
    ).updateOne(
      {
        operationId: input.operationId,
        status: { $in: ['SYNC_PENDING', 'BOUND'] },
      },
      {
        $set: {
          status: 'BOUND',
          installationId: input.installationId,
          updatedAt: input.updatedAt,
        },
      },
      { session },
    );
    if (updated.matchedCount !== 1) {
      const current = await fleetMongoCollection(
        this.connection,
        'agent_management_fleet_operations',
      ).findOne({ operationId: input.operationId }, { session });
      if (
        current?.['status'] === 'BOUND' &&
        current?.['installationId'] === input.installationId
      ) {
        return;
      }
      throw new FleetConflictError('FLEET_OPERATION_TERMINAL');
    }
  }
}

function invitationFields(input: {
  readonly invitationId: string;
  readonly status: FleetInvitationState;
  readonly installationId?: string;
  readonly expiresAt: Date;
  readonly updatedAt: Date;
}): Record<string, unknown> {
  const status = mapStatus(input.status);
  return {
    invitationId: input.invitationId,
    ...(status ? { status } : {}),
    expiresAt: input.expiresAt,
    updatedAt: input.updatedAt,
    ...(input.installationId ? { installationId: input.installationId } : {}),
  };
}

function mapStatus(
  status: FleetInvitationState,
): FleetEnrollmentOperationStatus | undefined {
  switch (status) {
    case 'PENDING':
      return 'INVITATION_ISSUED';
    case 'REDEEMED':
      return 'SYNC_PENDING';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'UNKNOWN':
      return undefined;
  }
}

function parseOperation(
  document: Record<string, unknown>,
): FleetEnrollmentOperation {
  const statuses: readonly FleetEnrollmentOperationStatus[] = [
    'REQUEST_PENDING',
    'INVITATION_ISSUED',
    'SYNC_PENDING',
    'BOUND',
    'CANCELLED',
    'EXPIRED',
    'REVOKED',
  ];
  if (
    typeof document['operationId'] !== 'string' ||
    typeof document['idempotencyHash'] !== 'string' ||
    typeof document['fingerprint'] !== 'string' ||
    typeof document['actorId'] !== 'string' ||
    typeof document['nodeId'] !== 'string' ||
    typeof document['status'] !== 'string' ||
    !statuses.includes(document['status'] as FleetEnrollmentOperationStatus)
  ) {
    throw new FleetUnavailableError(false);
  }
  if (
    document['invitationId'] !== undefined &&
    typeof document['invitationId'] !== 'string'
  ) {
    throw new FleetUnavailableError(false);
  }
  if (
    document['installationId'] !== undefined &&
    typeof document['installationId'] !== 'string'
  ) {
    throw new FleetUnavailableError(false);
  }
  if (
    document['expiresAt'] !== undefined &&
    !(document['expiresAt'] instanceof Date)
  ) {
    throw new FleetUnavailableError(false);
  }
  return {
    operationId: document['operationId'],
    idempotencyHash: document['idempotencyHash'],
    fingerprint: document['fingerprint'],
    actorId: document['actorId'],
    nodeId: document['nodeId'],
    status: document['status'] as FleetEnrollmentOperationStatus,
    ...(typeof document['invitationId'] === 'string'
      ? { invitationId: document['invitationId'] }
      : {}),
    ...(typeof document['installationId'] === 'string'
      ? { installationId: document['installationId'] }
      : {}),
    ...(document['expiresAt'] instanceof Date
      ? { expiresAt: document['expiresAt'] }
      : {}),
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

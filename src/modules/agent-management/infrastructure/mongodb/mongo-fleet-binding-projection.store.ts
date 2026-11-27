import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import type {
  BindingProjectionPort,
  BindingProjectionResult,
} from '../../application/binding/binding-projection.port';
import { fleetMongoCollection } from './fleet-mongo.types';

@Injectable()
export class MongoFleetBindingProjectionStore implements BindingProjectionPort {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async hasActiveForNode(
    nodeId: string,
    context?: UnitOfWorkContext,
  ): Promise<boolean> {
    const session = context;
    return (
      (await fleetMongoCollection(
        this.connection,
        'agent_management_fleet_bindings',
      ).countDocuments(
        { nodeId, status: 'active' },
        session ? { session } : undefined,
      )) > 0
    );
  }

  async upsert(
    input: {
      readonly bindingId: string;
      readonly invitationId: string;
      readonly installationId: string;
      readonly nodeId: string;
      readonly createdAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<BindingProjectionResult> {
    const session = context;
    const bindings = fleetMongoCollection(
      this.connection,
      'agent_management_fleet_bindings',
    );
    const existing = await bindings.findOne(
      { invitationId: input.invitationId },
      { session },
    );
    if (existing) {
      if (
        existing['installationId'] !== input.installationId ||
        existing['nodeId'] !== input.nodeId
      ) {
        return 'CONFLICT';
      }
      return existing['status'] === 'active' ? 'EXISTS' : 'REVOKED';
    }

    const duplicate = await bindings.findOne(
      {
        status: 'active',
        $or: [
          { nodeId: input.nodeId },
          { installationId: input.installationId },
        ],
      },
      { session, projection: { bindingId: 1 } },
    );
    if (duplicate) return 'CONFLICT';

    try {
      await bindings.insertOne(
        {
          bindingId: input.bindingId,
          invitationId: input.invitationId,
          installationId: input.installationId,
          nodeId: input.nodeId,
          status: 'active',
          source: 'fleet',
          createdAt: input.createdAt,
        },
        { session },
      );
      return 'CREATED';
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const raced = await bindings.findOne(
        { invitationId: input.invitationId },
        { session },
      );
      return raced?.['status'] === 'active' &&
        raced?.['installationId'] === input.installationId &&
        raced?.['nodeId'] === input.nodeId
        ? 'EXISTS'
        : 'CONFLICT';
    }
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

import type { MongoMigration } from '@platform/database/mongodb/migrations';
import { fleetMongoCollection } from '../fleet-mongo.types';

export const FLEET_ENROLLMENT_OPERATION_MIGRATION: MongoMigration = {
  id: '20261122T000000Z_agent_fleet_enrollment_operations',
  module: 'agent-management',
  description:
    'Create idempotency indexes for Core Fleet invitation operations',
  async up(connection) {
    const operations = fleetMongoCollection(
      connection,
      'agent_management_fleet_operations',
    );
    await operations.createIndex(
      { idempotencyHash: 1 },
      { unique: true, name: 'uq_agent_fleet_operation_idempotency_hash' },
    );
    await operations.createIndex(
      { operationId: 1 },
      { unique: true, name: 'uq_agent_fleet_operation_id' },
    );
    await operations.createIndex(
      { invitationId: 1 },
      {
        unique: true,
        name: 'uq_agent_fleet_operation_invitation_id',
        partialFilterExpression: { invitationId: { $type: 'string' } },
      },
    );
  },
};

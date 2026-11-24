import type { MongoMigration } from '@platform/database/mongodb/migrations';
import { assetMongoCollection } from '../asset-mongo.types';

export const NODE_LIFECYCLE_OPERATIONS_MIGRATION: MongoMigration = {
  id: '20261122T120000Z_asset_topology_node_lifecycle_operations',
  module: 'asset-topology',
  description: 'Create durable Node lifecycle operation journal indexes',
  async up(connection) {
    const operations = assetMongoCollection(
      connection,
      'asset_topology_node_lifecycle_operations',
    );
    await Promise.all([
      operations.createIndex(
        { operationId: 1 },
        { unique: true, name: 'uq_asset_topology_lifecycle_operation_id' },
      ),
      operations.createIndex(
        { idempotencyHash: 1 },
        {
          unique: true,
          partialFilterExpression: { idempotencyHash: { $type: 'string' } },
          name: 'uq_asset_topology_lifecycle_idempotency_hash',
        },
      ),
      operations.createIndex(
        { nodeId: 1 },
        {
          unique: true,
          partialFilterExpression: {
            stage: {
              $in: [
                'GATE_CLOSE_PENDING',
                'CORE_CHANGE_PENDING',
                'COMMIT_PENDING_GATE_FINALIZE',
                'ABORT_PENDING_GATE_RESTORE',
              ],
            },
          },
          name: 'uq_asset_topology_pending_lifecycle_node',
        },
      ),
      operations.createIndex(
        { stage: 1, createdAt: 1 },
        { name: 'ix_asset_topology_pending_lifecycle_operations' },
      ),
    ]);
  },
};

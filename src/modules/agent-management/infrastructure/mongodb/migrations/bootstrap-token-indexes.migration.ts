import type { MongoMigration } from '@platform/database/mongodb/migrations';

export const BOOTSTRAP_TOKEN_INDEXES_MIGRATION: MongoMigration = {
  id: '20261030T000000Z_agent_bootstrap_token_indexes',
  module: 'agent-management',
  description: 'Create Agent bootstrap token and active binding indexes',
  async up(connection) {
    const tokens = connection.collection('agent_management_bootstrap_tokens');
    await tokens.createIndex(
      { tokenId: 1 },
      { unique: true, name: 'uq_agent_bootstrap_token_id' },
    );
    await tokens.createIndex(
      { tokenHash: 1 },
      { unique: true, name: 'uq_agent_bootstrap_token_hash' },
    );
    await tokens.createIndex(
      { nodeId: 1 },
      {
        unique: true,
        name: 'uq_agent_bootstrap_one_unused_per_node',
        partialFilterExpression: { status: 'active' },
      },
    );
    await tokens.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'ttl_agent_bootstrap_expiry' },
    );
    await connection.collection('agent_management_bindings').createIndex(
      { nodeId: 1 },
      {
        unique: true,
        name: 'uq_agent_active_binding_node',
        partialFilterExpression: { status: 'active' },
      },
    );
  },
};

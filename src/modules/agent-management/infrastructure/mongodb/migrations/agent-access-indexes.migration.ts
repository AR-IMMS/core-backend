import type { MongoMigration } from '@platform/database/mongodb/migrations';

export const AGENT_ACCESS_INDEXES_MIGRATION: MongoMigration = {
  id: '20261101T010000Z_agent_access_indexes',
  module: 'agent-management',
  description: 'Create Agent binding identity and credential access indexes',
  async up(connection) {
    await connection
      .collection('agent_management_bindings')
      .createIndex(
        { bindingId: 1 },
        { unique: true, name: 'uq_agent_binding_id' },
      );
    await connection
      .collection('agent_management_credentials')
      .createIndex(
        { bindingId: 1, status: 1 },
        { name: 'ix_agent_credentials_by_binding_status' },
      );
  },
};

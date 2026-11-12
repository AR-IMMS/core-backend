import type { MongoMigration } from '@platform/database/mongodb/migrations';

export const AGENT_REGISTRY_QUERY_INDEXES_MIGRATION: MongoMigration = {
  id: '20261102T000000Z_agent_registry_query_indexes',
  module: 'agent-management',
  description: 'Create installation-scoped Agent binding history query index',
  async up(connection) {
    await connection
      .collection('agent_management_bindings')
      .createIndex(
        { installationId: 1, createdAt: -1, bindingId: -1 },
        { name: 'ix_agent_bindings_installation_history' },
      );
  },
};

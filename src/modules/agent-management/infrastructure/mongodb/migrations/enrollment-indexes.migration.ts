import type { MongoMigration } from '@platform/database/mongodb/migrations';

export const ENROLLMENT_INDEXES_MIGRATION: MongoMigration = {
  id: '20261031T000000Z_agent_enrollment_indexes',
  module: 'agent-management',
  description:
    'Create Agent enrollment identity, binding, credential and attempt indexes',
  async up(connection) {
    await connection
      .collection('agent_management_installations')
      .createIndex(
        { installationId: 1 },
        { unique: true, name: 'uq_agent_installation_id' },
      );
    const bindings = connection.collection('agent_management_bindings');
    await bindings.createIndex(
      { installationId: 1 },
      {
        unique: true,
        name: 'uq_agent_active_binding_installation',
        partialFilterExpression: { status: 'active' },
      },
    );
    await connection
      .collection('agent_management_credentials')
      .createIndex(
        { credentialId: 1 },
        { unique: true, name: 'uq_agent_credential_id' },
      );
    await connection
      .collection('agent_management_credentials')
      .createIndex(
        { credentialHash: 1 },
        { unique: true, name: 'uq_agent_credential_hash' },
      );
    await connection
      .collection('agent_management_enrollment_attempts')
      .createIndex(
        { attemptId: 1 },
        { unique: true, name: 'uq_agent_enrollment_attempt_id' },
      );
  },
};

import type { MongoMigration } from '@platform/database/mongodb/migrations';

export const ENROLLMENT_RECOVERY_MIGRATION: MongoMigration = {
  id: '20261101T000000Z_agent_enrollment_recovery',
  module: 'agent-management',
  description: 'Create temporary Agent enrollment recovery escrow indexes',
  async up(connection) {
    const recovery = connection.collection(
      'agent_management_enrollment_recovery',
    );
    await recovery.createIndex(
      { attemptId: 1 },
      { unique: true, name: 'uq_agent_enrollment_recovery_attempt' },
    );
    await recovery.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'ttl_agent_enrollment_recovery' },
    );
  },
};

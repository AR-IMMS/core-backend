import type { MongoMigration } from '@platform/database/mongodb/migrations';

/** Installs the IAM user and session indexes required by current queries and invariants. */
export const IAM_INDEXES_MIGRATION: MongoMigration = {
  id: '20261017T000000Z_iam_collection_indexes',
  module: 'iam',
  description: 'Create IAM user and session indexes',

  async up(connection) {
    const database = connection.db;
    if (!database) {
      throw new Error('MongoDB connection has no active database.');
    }

    const users = database.collection('iam_users');
    await users.createIndex({ userId: 1 }, { unique: true, name: 'userId_1' });
    await users.createIndex(
      { normalizedUsername: 1 },
      { unique: true, name: 'uq_iam_user_normalized_username' },
    );
    await users.createIndex(
      { bootstrapKey: 1 },
      {
        unique: true,
        name: 'uq_iam_user_bootstrap_key',
        partialFilterExpression: { bootstrapKey: { $exists: true } },
      },
    );
    await users.createIndex(
      { normalizedEmail: 1 },
      { unique: true, name: 'uq_iam_user_normalized_email' },
    );
    await users.createIndex(
      { status: 1, role: 1 },
      { name: 'ix_iam_user_status_role' },
    );

    const sessions = database.collection('iam_sessions');
    await sessions.createIndex({ userId: 1 }, { name: 'userId_1' });
    await sessions.createIndex(
      { sessionId: 1 },
      { unique: true, name: 'uq_iam_session_id' },
    );
    await sessions.createIndex(
      { userId: 1, revokedAt: 1, expiresAt: 1, presenceLeaseExpiresAt: 1 },
      { name: 'ix_iam_session_live_presence' },
    );
    await sessions.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'ttl_iam_session_expiry' },
    );
  },
};

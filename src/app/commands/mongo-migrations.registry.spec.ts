import type { Connection } from 'mongoose';
import { APPLICATION_MONGO_MIGRATIONS } from './mongo-migrations.registry';

const IAM_INDEXES_MIGRATION_ID = '20261017T000000Z_iam_collection_indexes';

describe('application Mongo migration registry', () => {
  /** It registers an IAM migration that creates every declared user and session index. */
  test('applies the IAM collection indexes', async () => {
    const migration = APPLICATION_MONGO_MIGRATIONS.find(
      (candidate) => candidate.id === IAM_INDEXES_MIGRATION_ID,
    );
    expect(migration).toBeDefined();

    const createUserIndex = jest.fn().mockResolvedValue('user-index');
    const createSessionIndex = jest.fn().mockResolvedValue('session-index');
    const userCollection = { createIndex: createUserIndex };
    const sessionCollection = { createIndex: createSessionIndex };
    const database = {
      collection: jest.fn((name: string) =>
        name === 'iam_users' ? userCollection : sessionCollection,
      ),
    };
    const connection = { db: database } as unknown as Connection;

    await migration?.up(connection);

    expect(database.collection).toHaveBeenCalledWith('iam_users');
    expect(database.collection).toHaveBeenCalledWith('iam_sessions');
    expect(createUserIndex.mock.calls).toEqual([
      [{ userId: 1 }, { unique: true, name: 'userId_1' }],
      [
        { normalizedUsername: 1 },
        { unique: true, name: 'uq_iam_user_normalized_username' },
      ],
      [
        { bootstrapKey: 1 },
        {
          unique: true,
          name: 'uq_iam_user_bootstrap_key',
          partialFilterExpression: { bootstrapKey: { $exists: true } },
        },
      ],
      [
        { normalizedEmail: 1 },
        { unique: true, name: 'uq_iam_user_normalized_email' },
      ],
      [{ status: 1, role: 1 }, { name: 'ix_iam_user_status_role' }],
    ]);
    expect(createSessionIndex.mock.calls).toEqual([
      [{ userId: 1 }, { name: 'userId_1' }],
      [{ sessionId: 1 }, { unique: true, name: 'uq_iam_session_id' }],
      [
        { userId: 1, revokedAt: 1, expiresAt: 1, presenceLeaseExpiresAt: 1 },
        { name: 'ix_iam_session_live_presence' },
      ],
      [
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'ttl_iam_session_expiry' },
      ],
    ]);
  });

  /** It excludes the platform smoke-test data write from the production migration registry. */
  test('does not register the platform migration smoke test', () => {
    expect(
      APPLICATION_MONGO_MIGRATIONS.some((migration) =>
        migration.id.includes('smoke_test'),
      ),
    ).toBe(false);
  });
});

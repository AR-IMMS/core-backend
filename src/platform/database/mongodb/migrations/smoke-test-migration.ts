import type { MongoMigration } from './mongo-migration';

type SmokeTestDocument = {
  _id: string;
  purpose: string;
  createdAt: Date;
} & Record<string, unknown>;

export const SMOKE_TEST_MIGRATION: MongoMigration = {
  id: '20990101T000000Z_migration_runner_smoke_test',
  module: 'platform',
  description: 'Verify Mongo migration runner can apply and skip migrations',

  async up(connection) {
    const database = connection.db;

    if (!database) {
      throw new Error('MongoDB connection has no active database.');
    }

    await database
      .collection<SmokeTestDocument>('migration_smoke_test')
      .updateOne(
        { _id: 'baseline-v1' },
        {
          $setOnInsert: {
            purpose: 'migration-runner-smoke-test',
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
  },
};

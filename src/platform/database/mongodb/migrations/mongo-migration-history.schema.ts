import { Schema } from 'mongoose';

export const MONGO_MIGRATION_HISTORY_MODEL = 'MongoMigrationHistory';
export const MONGO_MIGRATION_HISTORY_COLLECTION = 'schema_migrations';

export type MongoMigrationStatus = 'running' | 'applied' | 'failed';

export interface MongoMigrationHistoryRecord {
  _id: string;
  module: string;
  description: string;
  status: MongoMigrationStatus;
  startedAt: Date;
  finishedAt?: Date;
  error?: string;
}

export const MongoMigrationHistorySchema =
  new Schema<MongoMigrationHistoryRecord>(
    {
      _id: {
        type: String,
        required: true,
      },
      module: {
        type: String,
        required: true,
      },
      description: {
        type: String,
        required: true,
      },
      status: {
        type: String,
        required: true,
        enum: ['running', 'applied', 'failed'],
      },
      startedAt: {
        type: Date,
        required: true,
      },
      finishedAt: {
        type: Date,
        required: false,
      },
      error: {
        type: String,
        required: false,
      },
    },
    {
      collection: MONGO_MIGRATION_HISTORY_COLLECTION,
      versionKey: false,
      timestamps: false,
      strict: 'throw',
    },
  );

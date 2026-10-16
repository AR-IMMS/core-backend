import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';

import type { MongoMigration } from './mongo-migration';
import { MONGO_MIGRATIONS } from './mongo-migrations.token';
import {
  MONGO_MIGRATION_HISTORY_MODEL,
  type MongoMigrationHistoryRecord,
} from './mongo-migration-history.schema';

export interface MongoMigrationRunResult {
  applied: string[];
  skipped: string[];
}

@Injectable()
export class MongoMigrationRunner {
  private readonly logger = new Logger(MongoMigrationRunner.name);

  constructor(
    @InjectConnection()
    private readonly connection: Connection,
    @InjectModel(MONGO_MIGRATION_HISTORY_MODEL)
    private readonly history: Model<MongoMigrationHistoryRecord>,
    @Inject(MONGO_MIGRATIONS)
    private readonly migrations: readonly MongoMigration[],
  ) {}

  async run(): Promise<MongoMigrationRunResult> {
    this.validateRegistry();

    const orderedMigrations = [...this.migrations].sort((left, right) =>
      left.id.localeCompare(right.id),
    );

    const result: MongoMigrationRunResult = {
      applied: [],
      skipped: [],
    };

    for (const migration of orderedMigrations) {
      const existing = await this.history.findById(migration.id).lean().exec();

      if (existing?.status === 'applied') {
        result.skipped.push(migration.id);
        continue;
      }

      this.logger.log(`Running ${migration.id}: ${migration.description}`);

      await this.history
        .updateOne(
          { _id: migration.id },
          {
            $set: {
              module: migration.module,
              description: migration.description,
              status: 'running',
              startedAt: new Date(),
            },
            $unset: {
              error: '',
              finishedAt: '',
            },
          },
          { upsert: true },
        )
        .exec();

      try {
        await migration.up(this.connection);

        await this.history
          .updateOne(
            { _id: migration.id },
            {
              $set: {
                status: 'applied',
                finishedAt: new Date(),
              },
              $unset: {
                error: '',
              },
            },
          )
          .exec();

        result.applied.push(migration.id);
        this.logger.log(`Applied ${migration.id}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        try {
          await this.history
            .updateOne(
              { _id: migration.id },
              {
                $set: {
                  status: 'failed',
                  error: message,
                },
              },
            )
            .exec();
        } catch (historyError: unknown) {
          const historyMessage =
            historyError instanceof Error
              ? historyError.message
              : String(historyError);

          this.logger.error(
            `Could not record failure for migration ${migration.id}: ${historyMessage}`,
          );
        }

        this.logger.error(`Migration ${migration.id} failed: ${message}`);
        throw error;
      }
    }

    return result;
  }

  private validateRegistry(): void {
    const seenIds = new Set<string>();

    for (const migration of this.migrations) {
      if (!migration.id.trim()) {
        throw new Error('Mongo migration ID must not be empty.');
      }

      if (seenIds.has(migration.id)) {
        throw new Error(`Duplicate Mongo migration ID: ${migration.id}`);
      }

      seenIds.add(migration.id);

      if (!migration.module.trim()) {
        throw new Error(`Migration ${migration.id} has no module owner.`);
      }

      if (!migration.description.trim()) {
        throw new Error(`Migration ${migration.id} has no description.`);
      }
    }
  }
}

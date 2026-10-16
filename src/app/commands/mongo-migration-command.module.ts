import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PlatformConfigModule } from '../../platform/config/config.module';
import { DatabaseModule } from '../../platform/database/database.module';
import {
  MONGO_MIGRATION_HISTORY_MODEL,
  MongoMigrationHistorySchema,
} from '../../platform/database/mongodb/migrations/mongo-migration-history.schema';
import { MongoMigrationRunner } from '../../platform/database/mongodb/migrations/mongo-migration-runner';
import { MONGO_MIGRATIONS } from '../../platform/database/mongodb/migrations/mongo-migrations.token';
import { APPLICATION_MONGO_MIGRATIONS } from './mongo-migrations.registry';

@Module({
  imports: [
    PlatformConfigModule,
    DatabaseModule,
    MongooseModule.forFeature([
      {
        name: MONGO_MIGRATION_HISTORY_MODEL,
        schema: MongoMigrationHistorySchema,
      },
    ]),
  ],
  providers: [
    {
      provide: MONGO_MIGRATIONS,
      useValue: APPLICATION_MONGO_MIGRATIONS,
    },
    MongoMigrationRunner,
  ],
  exports: [MongoMigrationRunner],
})
export class MongoMigrationCommandModule {}

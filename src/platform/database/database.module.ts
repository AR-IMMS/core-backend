import { Module } from '@nestjs/common';

import { MongoDatabaseModule } from './mongodb/mongodb.module';

/**
 * Composes the database connections used by Core.
 */
@Module({
  imports: [MongoDatabaseModule],
})
export class DatabaseModule {}

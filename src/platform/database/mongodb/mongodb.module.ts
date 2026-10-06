import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { PlatformConfigModule } from '@platform/config/config.module';

/**
 * Provides the shared MongoDB connection used by Core.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [PlatformConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('database.mongodb.uri'),
        dbName: configService.getOrThrow<string>('database.mongodb.dbName'),
        retryAttempts: 5,
        retryDelay: 3_000,
      }),
    }),
  ],
})
export class MongoDatabaseModule {}

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { PlatformConfigModule } from '@platform/config';
import { MongoHealthProbe } from '@platform/health';

/**
 * Provides the shared MongoDB connection and its infrastructure health probe.
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
  providers: [MongoHealthProbe],
  exports: [MongoHealthProbe],
})
export class MongoDatabaseModule {}

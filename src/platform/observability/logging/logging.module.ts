import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as NestPinoModule } from 'nestjs-pino';

import { PlatformConfigModule } from '@platform/config/config.module';
import type { LogLevel } from '@platform/config/logging.config';

import { createPinoHttpOptions } from './logging.options';

/**
 * Configures the shared Pino logger and HTTP access logging for Core.
 */
@Module({
  imports: [
    NestPinoModule.forRootAsync({
      imports: [PlatformConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: createPinoHttpOptions(
          configService.getOrThrow<LogLevel>('logging.level'),
        ),
      }),
    }),
  ],
})
export class LoggingModule {}

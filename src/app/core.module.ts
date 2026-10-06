import { Module } from '@nestjs/common';

import { PlatformConfigModule } from '@platform/config';
import { DatabaseModule } from '@platform/database';
import { HealthModule } from '@platform/health';
import { HttpModule } from '@platform/http';
import { LoggingModule } from '@platform/observability/logging';

/**
 * Composes the shared platform modules used by the Core application.
 */
@Module({
  imports: [
    PlatformConfigModule,
    HttpModule,
    LoggingModule,
    DatabaseModule,
    HealthModule,
  ],
})
export class CoreModule {}

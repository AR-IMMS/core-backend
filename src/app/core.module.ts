import { TracingModule } from '@/platform/observability/tracing';
import { Module } from '@nestjs/common';

import { AuditEventConsumer } from '@modules/audit/application/audit-event.consumer';
import { AuditModule } from '@modules/audit/audit.module';
import { AssetTopologyModule } from '@modules/asset-topology/asset-topology.module';
import { IamModule } from '@modules/iam/iam.module';
import { PlatformConfigModule } from '@platform/config';
import { DatabaseModule } from '@platform/database';
import { PlatformEventsModule } from '@platform/events';
import { HealthModule } from '@platform/health';
import { HttpModule } from '@platform/http';
import { LoggingModule } from '@platform/observability/logging';
import { OutboxRelayScheduler } from './outbox-relay.scheduler';

/**
 * Composes the shared platform modules used by the Core application.
 */
@Module({
  imports: [
    PlatformConfigModule,
    IamModule,
    AssetTopologyModule,
    HttpModule,
    DatabaseModule,
    PlatformEventsModule.register({
      imports: [AuditModule],
      consumers: [AuditEventConsumer],
    }),
    HealthModule,
    LoggingModule,
    TracingModule,
  ],
  providers: [OutboxRelayScheduler],
})
export class CoreModule {}

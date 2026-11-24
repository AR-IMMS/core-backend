import { TracingModule } from '@/platform/observability/tracing';
import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { TicketModule } from '@modules/ticket/ticket.module';

import { AuditEventConsumer } from '@modules/audit/application/audit-event.consumer';
import { AuditModule } from '@modules/audit/audit.module';
import { AssetTopologyModule } from '@modules/asset-topology/asset-topology.module';
import { AgentManagementModule } from '@modules/agent-management/agent-management.module';
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
    ConditionalModule.registerWhen(
      TicketModule,
      (env) => env.TICKET_API_ENABLED === 'true',
      { debug: false },
    ),
    IamModule,
    AssetTopologyModule,
    AgentManagementModule,
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

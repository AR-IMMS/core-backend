# Platform Events

## 🚀 Quickstart (30-second Onboarding)

Register consumer modules and their exported provider tokens once at the application composition boundary. `DatabaseModule` must provide the shared Mongoose connection.

```ts
import { Module, Injectable, Inject } from '@nestjs/common';
import { AuditEventConsumer } from '@modules/audit/application/audit-event.consumer';
import { AuditModule } from '@modules/audit/audit.module';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION,
  type AuditFact,
  PlatformEventsModule,
  type OutboxWriterPort,
  type UnitOfWorkPort,
  OUTBOX_WRITER_PORT,
  UNIT_OF_WORK_PORT,
} from '@platform/events';
import { DatabaseModule } from '@platform/database';

@Module({
  imports: [
    DatabaseModule,
    PlatformEventsModule.register({
      imports: [AuditModule],
      consumers: [AuditEventConsumer],
    }),
  ],
})
export class CoreModule {}

@Injectable()
export class ExampleProducer {
  constructor(
    @Inject(UNIT_OF_WORK_PORT)
    private readonly unitOfWork: UnitOfWorkPort,
    @Inject(OUTBOX_WRITER_PORT)
    private readonly outbox: OutboxWriterPort,
  ) {}

  async recordChange(): Promise<void> {
    const fact: AuditFact = {
      event_id: crypto.randomUUID(),
      event_type: AUDIT_FACT_EVENT_TYPE,
      event_version: AUDIT_FACT_EVENT_VERSION,
      producer: 'example',
      occurred_at: new Date().toISOString(),
      resource: { type: 'example-resource', id: 'resource-123', sequence: 1 },
      payload: {
        actor: { type: 'user', id: 'user-123' },
        action: 'example.updated',
        changes: [{ field: 'displayName', before: 'Old', after: 'New' }],
      },
      context: {},
    };

    await this.unitOfWork.run(async (context) => {
      // Perform participating domain persistence here with this same context.
      await this.outbox.append(fact, context);
    });
  }
}
```

## 🗺️ Architecture Overview

Application code depends on event contracts and ports, while MongoDB adapters implement persistence and NestJS composition binds the ports at the application boundary. Producers append versioned facts inside a Unit of Work, and registered consumers receive them through the outbox relay without importing one another's internal models.

## ⚡ Cheat Sheet

| Common Task                          | Service/Port to Inject                  | Method/Usage                                                                          |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------- |
| Persist a fact with producer changes | `UnitOfWorkPort` and `OutboxWriterPort` | `unitOfWork.run(async (context) => outbox.append(fact, context))`                     |
| Define a consumer                    | `EventConsumerPort<TFact>`              | Implement `consumerId`, exact `subscriptions`, and `handle(fact)`                     |
| Inspect registered consumers         | `EventConsumerDispatchPort`             | `registrations()`                                                                     |
| Dispatch a fact directly             | `EventConsumerDispatchPort`             | `dispatch(consumerId, fact)`; normally called by the relay                            |
| Process eligible delivery work       | `OutboxRelayService`                    | `runOnce(now?)`; Core's `OutboxRelayScheduler` invokes it on startup and every second |
| Create a typed contract version      | `businessFactVersion`                   | `businessFactVersion(1)`                                                              |
| Validate shared Audit payload        | `parseAuditFactPayload`                 | `parseAuditFactPayload(payload)` before persistence                                   |

## ⚙️ Configuration Reference

`PlatformEventsModule` uses the Mongoose connection configured by `DatabaseModule`; it does not create a separate connection or accept a batch-size option.

| Property                                     | Type                                     | Default        | Required              | Description                                                                                                                         |
| -------------------------------------------- | ---------------------------------------- | -------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                                | `string`                                 | None           | Yes at runtime        | MongoDB URI for the shared Mongoose connection. Transactional event writes require a replica set.                                   |
| `MONGODB_DB_NAME`                            | `string`                                 | `ar_imms_core` | No                    | Database name for the shared connection.                                                                                            |
| `PlatformEventsModuleOptions.imports`        | `NonNullable<ModuleMetadata['imports']>` | None           | Yes                   | Nest modules that export the registered consumer providers, for example `[AuditModule]`.                                            |
| `PlatformEventsModuleOptions.consumers`      | `readonly InjectionToken[]`              | None           | Yes                   | Explicit provider tokens for consumers, for example `[AuditEventConsumer]`.                                                         |
| `OutboxRelayService` constructor `batchSize` | `number`                                 | `100`          | No                    | Maximum claims per consumer in one relay pass. The module's default provider uses `100`; it is not a `PlatformEventsModule` option. |
| `MONGODB_TEST_URI`                           | `string`                                 | None           | For MongoDB e2e tests | Test-only replica-set URI consumed by the e2e setup, not a production module option.                                                |

## ⚠️ Gotchas & Pitfalls

- Keep domain persistence and `OutboxWriterPort.append` inside the same `UnitOfWorkPort.run` callback and pass the callback's `UnitOfWorkContext` to every participating adapter. The context is opaque; application code must not inspect or retain it.
- A successful producer transaction persists the fact in the Outbox. The Core host's `OutboxRelayScheduler` invokes `OutboxRelayService.runOnce()` immediately after application bootstrap and every second afterward; `PlatformEventsModule` itself does not start a timer or background process. Do not add a second relay scheduler to the Core host.
- Delivery is at least once. A consumer can commit its durable effect and fail before the outbox acknowledgement, so consumer handling must be idempotent.
- Consumers have independent progress, and delivery for each resource is ordered by `resource.type`, `resource.id`, and `resource.sequence`. Producers must supply a monotonically increasing sequence for each resource.
- A consumer module must both appear in `PlatformEventsModule.register({ imports })` and export the provider token listed in `consumers`. Wildcard event subscriptions are rejected.
- The event module injects the default Mongoose connection through `@InjectModel(OUTBOX_ENTRY_MODEL)` and `@InjectConnection()`. Import the app's `DatabaseModule`; do not configure another default connection just for events.
- MongoDB transactions need a replica set. For local development, run `docker compose up -d --wait mongodb` and use the replica-set URI documented in the root README.
- `AuditFact` permits only the shared business-neutral actor/action/change contract. Change fields are explicit scalar values; payload validation rejects unknown properties and sensitive field names.

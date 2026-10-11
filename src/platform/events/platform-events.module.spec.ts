import { AuditEventConsumer } from '@modules/audit/application/audit-event.consumer';
import { AuditModule } from '@modules/audit/audit.module';
import {
  EVENT_CONSUMER_DISPATCH_PORT,
  EVENT_CONSUMER_PORTS,
  OUTBOX_DELIVERY_PORT,
  OUTBOX_WRITER_PORT,
  UNIT_OF_WORK_PORT,
} from './application/ports/event-ports.tokens';
import { MongoOutboxStore } from './infrastructure/mongodb/mongo-outbox.store';
import { MongoUnitOfWork } from './infrastructure/mongodb/mongo-unit-of-work';
import { OutboxRelayService } from './application/outbox-relay.service';
import { PlatformEventsModule } from './platform-events.module';

describe('PlatformEventsModule', () => {
  test('binds ports to Mongo adapters and only the explicitly supplied consumers', () => {
    const module = PlatformEventsModule.register({
      imports: [AuditModule],
      consumers: [AuditEventConsumer],
    });
    const providers = module.providers ?? [];
    const consumerProvider = providers.find(
      (provider) =>
        typeof provider === 'object' &&
        'provide' in provider &&
        provider.provide === EVENT_CONSUMER_PORTS,
    );

    expect(module.imports).toContain(AuditModule);
    expect(consumerProvider).toMatchObject({
      provide: EVENT_CONSUMER_PORTS,
      inject: [AuditEventConsumer],
    });
    expect(providers).toContain(MongoOutboxStore);
    expect(providers).toContain(MongoUnitOfWork);
    expect(providers).toContainEqual({
      provide: OUTBOX_WRITER_PORT,
      useExisting: MongoOutboxStore,
    });
    expect(providers).toContainEqual({
      provide: OUTBOX_DELIVERY_PORT,
      useExisting: MongoOutboxStore,
    });
    expect(providers).toContainEqual({
      provide: UNIT_OF_WORK_PORT,
      useExisting: MongoUnitOfWork,
    });
    expect(providers).toContainEqual(
      expect.objectContaining({ provide: EVENT_CONSUMER_DISPATCH_PORT }),
    );
    expect(providers).toContainEqual(
      expect.objectContaining({ provide: OutboxRelayService }),
    );
  });
});

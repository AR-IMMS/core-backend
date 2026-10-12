import {
  type DynamicModule,
  type InjectionToken,
  type ModuleMetadata,
  Global,
  Module,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import type {
  EventConsumerDispatchPort,
  EventConsumerPort,
} from './application/ports/event-consumer.port';
import { EventConsumerRegistry } from './application/event-consumer.registry';
import { OutboxRelayService } from './application/outbox-relay.service';
import {
  EVENT_CONSUMER_DISPATCH_PORT,
  EVENT_CONSUMER_PORTS,
  OUTBOX_DELIVERY_PORT,
  OUTBOX_WRITER_PORT,
  UNIT_OF_WORK_PORT,
} from './application/ports/event-ports.tokens';
import { MongoOutboxStore } from './infrastructure/mongodb/mongo-outbox.store';
import { MongoUnitOfWork } from './infrastructure/mongodb/mongo-unit-of-work';
import {
  OUTBOX_ENTRY_MODEL,
  OutboxEntrySchema,
} from './infrastructure/mongodb/outbox.schema';

export interface PlatformEventsModuleOptions {
  /**
   * Modules that export the consumer provider tokens listed in `consumers`.
   * @default None; required when registering the module.
   * @example `[AuditModule]`
   */
  readonly imports: NonNullable<ModuleMetadata['imports']>;
  /**
   * Explicit consumer provider tokens registered with the relay.
   * @default None; required when registering the module.
   * @example `[AuditEventConsumer]`
   */
  readonly consumers: readonly InjectionToken[];
}

/**
 * Binds event ports to MongoDB persistence and the in-process relay.
 * Import `DatabaseModule` at the application boundary before registering this
 * module so Mongoose uses the application's shared connection.
 */
@Global()
@Module({})
export class PlatformEventsModule {
  /**
   * Creates the global event module and registers its consumer allowlist.
   * @param options Consumer modules and exported consumer provider tokens.
   * @returns Dynamic Nest module exposing event ports and the relay service.
   * @example `PlatformEventsModule.register({ imports: [AuditModule], consumers: [AuditEventConsumer] })`
   */
  static register(options: PlatformEventsModuleOptions): DynamicModule {
    return {
      module: PlatformEventsModule,
      imports: [
        ...options.imports,
        MongooseModule.forFeature([
          { name: OUTBOX_ENTRY_MODEL, schema: OutboxEntrySchema },
        ]),
      ],
      providers: [
        MongoOutboxStore,
        MongoUnitOfWork,
        {
          provide: OUTBOX_WRITER_PORT,
          useExisting: MongoOutboxStore,
        },
        {
          provide: OUTBOX_DELIVERY_PORT,
          useExisting: MongoOutboxStore,
        },
        {
          provide: UNIT_OF_WORK_PORT,
          useExisting: MongoUnitOfWork,
        },
        {
          provide: EVENT_CONSUMER_PORTS,
          useFactory: (...consumers: EventConsumerPort[]) => consumers,
          inject: [...options.consumers],
        },
        {
          provide: EVENT_CONSUMER_DISPATCH_PORT,
          useFactory: (
            consumers: readonly EventConsumerPort[],
          ): EventConsumerDispatchPort => new EventConsumerRegistry(consumers),
          inject: [EVENT_CONSUMER_PORTS],
        },
        {
          provide: OutboxRelayService,
          useFactory: (
            outbox: MongoOutboxStore,
            dispatch: EventConsumerDispatchPort,
          ) => new OutboxRelayService(outbox, dispatch),
          inject: [OUTBOX_DELIVERY_PORT, EVENT_CONSUMER_DISPATCH_PORT],
        },
      ],
      exports: [
        OUTBOX_WRITER_PORT,
        OUTBOX_DELIVERY_PORT,
        UNIT_OF_WORK_PORT,
        EVENT_CONSUMER_DISPATCH_PORT,
        OutboxRelayService,
      ],
    };
  }
}

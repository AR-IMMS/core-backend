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
  /** Modules that export the explicitly registered consumer provider tokens. */
  readonly imports: NonNullable<ModuleMetadata['imports']>;
  readonly consumers: readonly InjectionToken[];
}

/** Binds event ports to MongoDB persistence and the in-process relay. */
@Global()
@Module({})
export class PlatformEventsModule {
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

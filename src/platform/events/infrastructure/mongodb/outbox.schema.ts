import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

import type { BusinessFactEnvelope } from '../../domain/business-fact-envelope';

export const OUTBOX_ENTRY_MODEL = 'PlatformEventOutboxEntry';
export const OUTBOX_COLLECTION = 'platform_event_outbox';

export const OUTBOX_DELIVERY_STATES = [
  'pending',
  'claimed',
  'retryable',
  'delivered',
] as const;

export type OutboxDeliveryState = (typeof OUTBOX_DELIVERY_STATES)[number];

/** Per-consumer delivery progress stored with an Outbox fact. */
@Schema({ _id: false })
export class OutboxDeliveryRecord {
  @Prop({ required: true, type: String })
  consumerId!: string;

  @Prop({
    required: true,
    type: String,
    enum: OUTBOX_DELIVERY_STATES,
    default: 'pending',
  })
  state!: OutboxDeliveryState;

  @Prop({ required: true, type: Number, default: 0 })
  attemptCount!: number;

  @Prop({ required: true, type: Date })
  nextAttemptAt!: Date;

  @Prop({ type: String, default: null })
  claimId!: string | null;

  @Prop({ type: Date, default: null })
  claimedAt!: Date | null;

  @Prop({ type: Date, default: null })
  leaseExpiresAt!: Date | null;

  @Prop({ type: Date, default: null })
  failedAt!: Date | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;
}

export const OutboxDeliverySchema =
  SchemaFactory.createForClass(OutboxDeliveryRecord);

/** Infrastructure record holding a fact and its independent delivery states. */
@Schema({
  collection: OUTBOX_COLLECTION,
  versionKey: false,
  timestamps: { createdAt: 'createdAt', updatedAt: false },
})
export class OutboxEntry {
  @Prop({ required: true, type: MongooseSchema.Types.Mixed })
  fact!: BusinessFactEnvelope;

  @Prop({ type: [OutboxDeliverySchema], default: [] })
  deliveries!: OutboxDeliveryRecord[];

  createdAt!: Date;
}

export const OutboxEntrySchema = SchemaFactory.createForClass(OutboxEntry);

OutboxEntrySchema.index(
  { 'fact.event_id': 1 },
  { unique: true, name: 'uq_platform_event_outbox_event_id' },
);

OutboxEntrySchema.index(
  {
    'fact.event_type': 1,
    'fact.event_version': 1,
  },
  { name: 'ix_platform_event_outbox_contract' },
);

OutboxEntrySchema.index(
  {
    'deliveries.state': 1,
    'deliveries.nextAttemptAt': 1,
    'deliveries.leaseExpiresAt': 1,
    'fact.resource.type': 1,
    'fact.resource.id': 1,
    'fact.resource.sequence': 1,
  },
  { name: 'ix_platform_event_outbox_delivery_eligibility' },
);

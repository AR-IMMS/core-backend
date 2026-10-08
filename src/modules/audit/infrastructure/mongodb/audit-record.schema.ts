import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

import type { AuditActor } from '@platform/events';
import type { AuditChange, AuditRecord } from '../../domain/audit-record';

export const AUDIT_RECORD_MODEL = 'AuditRecord';
export const AUDIT_RECORD_COLLECTION = 'audit_records';

@Schema({ _id: false })
export class AuditActorEntry implements AuditActor {
  @Prop({ required: true, type: String })
  type!: string;

  @Prop({ required: true, type: String })
  id!: string;
}

export const AuditActorEntrySchema =
  SchemaFactory.createForClass(AuditActorEntry);

@Schema({ _id: false })
export class AuditChangeEntry implements AuditChange {
  @Prop({ required: true, type: String })
  field!: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  before?: string | number | boolean | null;

  @Prop({ type: MongooseSchema.Types.Mixed })
  after?: string | number | boolean | null;
}

export const AuditChangeEntrySchema =
  SchemaFactory.createForClass(AuditChangeEntry);

/** Append-only document; its event ID is the idempotency key. */
@Schema({
  collection: AUDIT_RECORD_COLLECTION,
  versionKey: false,
  timestamps: { createdAt: 'createdAt', updatedAt: false },
})
export class AuditRecordEntry implements AuditRecord {
  @Prop({ required: true, type: String })
  eventId!: string;

  @Prop({ required: true, type: String })
  eventType!: string;

  @Prop({ required: true, type: Number })
  eventVersion!: number;

  @Prop({ required: true, type: String })
  producer!: string;

  @Prop({ required: true, type: AuditActorEntrySchema })
  actor!: AuditRecord['actor'];

  @Prop({ required: true, type: String })
  action!: string;

  @Prop({ required: true, type: MongooseSchema.Types.Mixed })
  resource!: AuditRecord['resource'];

  @Prop({ required: true, type: Date })
  occurredAt!: Date;

  @Prop({ required: true, type: MongooseSchema.Types.Mixed })
  context!: AuditRecord['context'];

  @Prop({ type: [AuditChangeEntrySchema], default: [] })
  changes!: AuditChange[];

  createdAt!: Date;
}

export const AuditRecordSchema = SchemaFactory.createForClass(AuditRecordEntry);

AuditRecordSchema.index(
  { eventId: 1 },
  { unique: true, name: 'uq_audit_record_event_id' },
);

AuditRecordSchema.index(
  { 'resource.type': 1, 'resource.id': 1, occurredAt: -1 },
  { name: 'ix_audit_record_resource_time' },
);

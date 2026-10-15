import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const IAM_SESSION_MODEL = 'IamSession';
export const IAM_SESSION_COLLECTION = 'iam_sessions';

/** One device session with rotating credentials and its presence lease. */
@Schema({
  collection: IAM_SESSION_COLLECTION,
  versionKey: false,
  timestamps: { createdAt: true, updatedAt: false },
})
export class IamSessionEntry {
  @Prop({ required: true, type: String, unique: true })
  sessionId!: string;

  @Prop({ required: true, type: String, index: true })
  userId!: string;

  @Prop({ required: true, type: String, select: false })
  refreshTokenHash!: string;

  @Prop({ required: true, type: [String], default: [], select: false })
  usedRefreshTokenHashes!: string[];

  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Date, default: null })
  presenceLeaseExpiresAt!: Date | null;

  createdAt!: Date;
}

export const IamSessionSchema = SchemaFactory.createForClass(IamSessionEntry);
IamSessionSchema.index(
  { sessionId: 1 },
  { unique: true, name: 'uq_iam_session_id' },
);
IamSessionSchema.index(
  { userId: 1, revokedAt: 1, expiresAt: 1, presenceLeaseExpiresAt: 1 },
  { name: 'ix_iam_session_live_presence' },
);
IamSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'ttl_iam_session_expiry' },
);

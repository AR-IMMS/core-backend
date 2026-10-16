import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { PermissionCode, RoleCode } from '../../domain/role-permissions';
import type { UserPresencePreference } from '../../domain/user-presence';
import type { UserStatus } from '../../domain/user';

export const IAM_USER_MODEL = 'IamUser';
export const IAM_USER_COLLECTION = 'iam_users';

/** IAM-owned human account state; secrets are never exposed from this model. */
@Schema({
  collection: IAM_USER_COLLECTION,
  versionKey: false,
  timestamps: true,
})
export class IamUserEntry {
  @Prop({ required: true, type: String, unique: true })
  userId!: string;

  @Prop({ required: true, type: String })
  username!: string;

  @Prop({ required: true, type: String, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true, type: String, lowercase: true, trim: true })
  normalizedUsername!: string;

  @Prop({ required: true, type: String, lowercase: true, trim: true })
  normalizedEmail!: string;

  @Prop({ type: String, default: null })
  displayName!: string | null;

  @Prop({ required: true, enum: ['IT_ADMIN', 'OPERATOR', 'TECHNICIAN'] })
  role!: RoleCode;

  @Prop({ required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' })
  status!: UserStatus;

  @Prop({ type: [String], default: [] })
  additionalPermissions!: PermissionCode[];

  @Prop({
    required: true,
    enum: ['AUTOMATIC', 'BUSY', 'AWAY'],
    default: 'AUTOMATIC',
  })
  presencePreference!: UserPresencePreference;

  @Prop({ required: true, type: String, select: false })
  passwordHash!: string;

  @Prop({ required: true, type: Boolean, default: true })
  mustChangePassword!: boolean;

  @Prop({ required: true, type: Number, default: 0, min: 0 })
  auditSequence!: number;

  @Prop({ required: true, type: Number, default: 0, min: 0 })
  adminGuardVersion!: number;

  @Prop({ type: String, select: false })
  bootstrapKey?: string;

  @Prop({ type: Date, default: null })
  passwordChangedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const IamUserSchema = SchemaFactory.createForClass(IamUserEntry);
IamUserSchema.index(
  { normalizedUsername: 1 },
  { unique: true, name: 'uq_iam_user_normalized_username' },
);
IamUserSchema.index(
  { bootstrapKey: 1 },
  {
    unique: true,
    name: 'uq_iam_user_bootstrap_key',
    partialFilterExpression: { bootstrapKey: { $exists: true } },
  },
);
IamUserSchema.index(
  { normalizedEmail: 1 },
  { unique: true, name: 'uq_iam_user_normalized_email' },
);
IamUserSchema.index(
  { status: 1, role: 1 },
  { name: 'ix_iam_user_status_role' },
);

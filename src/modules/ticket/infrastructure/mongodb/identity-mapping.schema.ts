import { Schema } from 'mongoose';
import {
  validateIdentityMapping,
  type IdentityMapping,
} from '../../domain/identity-mapping';
export const IDENTITY_MAPPING_MODEL = 'TicketZammadIdentityMapping';
export const IDENTITY_MAPPING_COLLECTION = 'ticket_zammad_identity_mappings';
export const IdentityMappingSchema = new Schema<IdentityMapping>(
  {
    instanceKey: { type: String, required: true, immutable: true },
    coreUserId: { type: String, required: true, immutable: true },
    zammadUserId: { type: Number, required: true, immutable: true },
    approvedGroupId: { type: Number, required: true },
    status: { type: String, enum: ['ACTIVE', 'REVOKED'], required: true },
    revision: { type: Number, required: true },
    approvedByCoreUserId: { type: String, required: true },
    approvalReference: { type: String, required: true },
    validatedAt: { type: Date, required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  {
    collection: IDENTITY_MAPPING_COLLECTION,
    versionKey: false,
    strict: 'throw',
  },
);
IdentityMappingSchema.pre('validate', function () {
  validateIdentityMapping(this.toObject());
});
IdentityMappingSchema.index(
  { instanceKey: 1, coreUserId: 1 },
  { unique: true, name: 'uq_ticket_identity_core' },
);
IdentityMappingSchema.index(
  { instanceKey: 1, zammadUserId: 1 },
  { unique: true, name: 'uq_ticket_identity_zammad' },
);

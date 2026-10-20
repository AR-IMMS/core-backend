import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const QR_MAPPING_MODEL = 'AssetTopologyQrMapping';

@Schema({
  collection: 'asset_topology_qr_mappings',
  versionKey: false,
  timestamps: false,
})
export class QrMappingEntry {
  @Prop({ required: true, type: String, immutable: true }) id!: string;
  @Prop({ required: true, type: String, immutable: true }) value!: string;
  @Prop({
    required: true,
    type: String,
    enum: ['asset', 'rack'],
    immutable: true,
  })
  targetType!: 'asset' | 'rack';
  @Prop({ required: true, type: String, immutable: true }) targetId!: string;
  @Prop({ required: true, type: Date, immutable: true }) validFrom!: Date;
  @Prop({ required: true, type: Boolean, default: true }) active!: boolean;
  @Prop({ required: false, type: Date }) validTo?: Date;
}

export const QrMappingSchema = SchemaFactory.createForClass(QrMappingEntry);
QrMappingSchema.index(
  { id: 1 },
  { unique: true, name: 'uq_asset_topology_qr_mapping_id' },
);
QrMappingSchema.index(
  { value: 1 },
  { unique: true, name: 'uq_asset_topology_qr_value_history' },
);
QrMappingSchema.index(
  { targetType: 1, targetId: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
    name: 'uq_asset_topology_active_qr_per_target',
  },
);
QrMappingSchema.index(
  { targetType: 1, targetId: 1, validFrom: -1 },
  { name: 'ix_asset_topology_qr_mapping_history' },
);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const ASSET_TYPE_MODEL = 'AssetTopologyAssetType';
export const ASSET_MODEL_MODEL = 'AssetTopologyAssetModel';
export const ASSET_MODEL = 'AssetTopologyAsset';

@Schema({ collection: 'asset_topology_asset_types', versionKey: false })
export class AssetTypeEntry {
  @Prop({ required: true, type: String, immutable: true })
  id!: string;

  @Prop({ required: true, type: String, trim: true })
  name!: string;
}

@Schema({ collection: 'asset_topology_asset_models', versionKey: false })
export class AssetModelEntry {
  @Prop({ required: true, type: String, immutable: true })
  id!: string;

  @Prop({ required: true, type: String, immutable: true })
  assetTypeId!: string;

  @Prop({ required: true, type: String, trim: true })
  name!: string;
}

@Schema({
  collection: 'asset_topology_assets',
  versionKey: false,
  timestamps: true,
})
export class AssetEntry {
  @Prop({ required: true, type: String, immutable: true })
  id!: string;

  @Prop({ required: true, type: String, trim: true })
  name!: string;

  @Prop({ required: true, type: String, immutable: true })
  assetTypeId!: string;

  @Prop({ type: String })
  assetModelId?: string;

  @Prop({ type: String })
  serialNumber?: string;

  @Prop({
    required: true,
    type: String,
    enum: ['ACTIVE', 'MAINTENANCE', 'RETIRED'],
    default: 'ACTIVE',
  })
  lifecycleState!: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';

  @Prop({ required: true, type: Number, min: 0, default: 0 })
  auditSequence!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AssetTypeSchema = SchemaFactory.createForClass(AssetTypeEntry);
export const AssetModelSchema = SchemaFactory.createForClass(AssetModelEntry);
export const AssetSchema = SchemaFactory.createForClass(AssetEntry);

AssetTypeSchema.index(
  { id: 1 },
  { unique: true, name: 'uq_asset_topology_asset_type_id' },
);
AssetModelSchema.index(
  { id: 1 },
  { unique: true, name: 'uq_asset_topology_asset_model_id' },
);
AssetSchema.index(
  { id: 1 },
  { unique: true, name: 'uq_asset_topology_asset_id' },
);

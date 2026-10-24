import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const ASSET_TOPOLOGY_ASSET_LOCATION_MODEL = 'AssetTopologyAssetLocation';

@Schema({
  collection: 'asset_topology_asset_locations',
  versionKey: false,
  timestamps: false,
})
export class AssetLocationEntry {
  @Prop({ required: true, type: String, immutable: true })
  id!: string;

  @Prop({ required: true, type: String, immutable: true })
  assetId!: string;

  @Prop({ required: true, type: String, immutable: true })
  rackId!: string;

  @Prop({ required: true, type: Number, min: 1, immutable: true })
  uPosition!: number;

  @Prop({ required: true, type: Date, immutable: true })
  validFrom!: Date;

  @Prop({ required: false, type: Date })
  validTo?: Date;
}

export const AssetLocationSchema =
  SchemaFactory.createForClass(AssetLocationEntry);

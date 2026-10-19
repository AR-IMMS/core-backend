import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const TOPOLOGY_DATA_CENTER_MODEL = 'AssetTopologyDataCenter';
export const TOPOLOGY_SITE_MODEL = 'AssetTopologySite';
export const TOPOLOGY_ROOM_MODEL = 'AssetTopologyRoom';

@Schema({
  collection: 'asset_topology_data_centers',
  versionKey: false,
  timestamps: true,
})
export class TopologyDataCenterEntry {
  @Prop({ required: true, type: String, immutable: true })
  id!: string;

  @Prop({ required: true, type: String })
  name!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

@Schema({
  collection: 'asset_topology_sites',
  versionKey: false,
  timestamps: true,
})
export class TopologySiteEntry {
  @Prop({ required: true, type: String, immutable: true })
  id!: string;

  @Prop({ required: true, type: String, trim: true })
  name!: string;

  @Prop({ required: true, type: String, immutable: true })
  dataCenterId!: string;

  @Prop({ required: true, type: Number, min: 0, default: 0 })
  auditSequence!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

@Schema({
  collection: 'asset_topology_rooms',
  versionKey: false,
  timestamps: true,
})
export class TopologyRoomEntry {
  @Prop({ required: true, type: String, immutable: true })
  id!: string;

  @Prop({ required: true, type: String, trim: true })
  name!: string;

  @Prop({ required: true, type: String, immutable: true })
  siteId!: string;

  @Prop({ required: true, type: Number, min: 1 })
  widthMm!: number;

  @Prop({ required: true, type: Number, min: 1 })
  depthMm!: number;

  @Prop({ required: true, type: Number, min: 1 })
  gridSnapMm!: number;

  @Prop({ required: true, type: Number, min: 0, default: 0 })
  auditSequence!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TopologyDataCenterSchema = SchemaFactory.createForClass(
  TopologyDataCenterEntry,
);
export const TopologySiteSchema =
  SchemaFactory.createForClass(TopologySiteEntry);
export const TopologyRoomSchema =
  SchemaFactory.createForClass(TopologyRoomEntry);

TopologyDataCenterSchema.index(
  { id: 1 },
  { unique: true, name: 'uq_asset_topology_data_center_id' },
);
TopologySiteSchema.index(
  { id: 1 },
  { unique: true, name: 'uq_asset_topology_site_id' },
);
TopologySiteSchema.index(
  { dataCenterId: 1, name: 1 },
  { name: 'ix_asset_topology_site_data_center_name' },
);
TopologyRoomSchema.index(
  { id: 1 },
  { unique: true, name: 'uq_asset_topology_room_id' },
);
TopologyRoomSchema.index(
  { siteId: 1, name: 1 },
  { name: 'ix_asset_topology_room_site_name' },
);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const TOPOLOGY_DATA_CENTER_MODEL = 'AssetTopologyDataCenter';
export const TOPOLOGY_SITE_MODEL = 'AssetTopologySite';
export const TOPOLOGY_ROOM_MODEL = 'AssetTopologyRoom';
export const TOPOLOGY_RACK_MODEL = 'AssetTopologyRack';
export const TOPOLOGY_RACK_LOCATION_MODEL = 'AssetTopologyRackLocation';

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

@Schema({ _id: false })
export class TopologyRoomWalkwayCellEntry {
  @Prop({ required: true, type: Number, min: 0 })
  column!: number;

  @Prop({ required: true, type: Number, min: 0 })
  row!: number;
}

export const TopologyRoomWalkwayCellSchema = SchemaFactory.createForClass(
  TopologyRoomWalkwayCellEntry,
);

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

  @Prop({
    required: true,
    type: [TopologyRoomWalkwayCellSchema],
    default: [],
  })
  walkwayCells!: { column: number; row: number }[];

  @Prop({ required: true, type: Number, min: 0, default: 0 })
  layoutRevision!: number;

  @Prop({
    required: true,
    type: String,
    enum: ['ACTIVE', 'RETIRED'],
    default: 'ACTIVE',
  })
  status!: 'ACTIVE' | 'RETIRED';

  @Prop({ required: true, type: Number, min: 0, default: 0 })
  auditSequence!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

@Schema({
  collection: 'asset_topology_racks',
  versionKey: false,
  timestamps: true,
})
export class TopologyRackEntry {
  @Prop({ required: true, type: String, immutable: true }) id!: string;
  @Prop({ required: true, type: Number, min: 1 }) uCapacity!: number;
  @Prop({ required: false, type: String, trim: true }) rowLabel?: string;
  @Prop({ required: false, type: String, trim: true }) positionInRow?: string;
  @Prop({ required: true, type: Number, min: 0, default: 0 })
  auditSequence!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

@Schema({
  collection: 'asset_topology_rack_locations',
  versionKey: false,
  timestamps: false,
})
export class TopologyRackLocationEntry {
  @Prop({ required: true, type: String, immutable: true }) id!: string;
  @Prop({ required: true, type: String, immutable: true }) rackId!: string;
  @Prop({ required: true, type: String, immutable: true }) roomId!: string;
  @Prop({ required: true, type: Number, min: 0, immutable: true })
  column!: number;
  @Prop({ required: true, type: Number, min: 0, immutable: true }) row!: number;
  @Prop({
    required: true,
    type: Number,
    enum: [0, 90, 180, 270],
    immutable: true,
  })
  rotation!: number;
  @Prop({ required: true, type: Date, immutable: true }) validFrom!: Date;
  @Prop({ required: false, type: Date }) validTo?: Date;
}

export const TopologyDataCenterSchema = SchemaFactory.createForClass(
  TopologyDataCenterEntry,
);
export const TopologySiteSchema =
  SchemaFactory.createForClass(TopologySiteEntry);
export const TopologyRoomSchema =
  SchemaFactory.createForClass(TopologyRoomEntry);
export const TopologyRackSchema =
  SchemaFactory.createForClass(TopologyRackEntry);
export const TopologyRackLocationSchema = SchemaFactory.createForClass(
  TopologyRackLocationEntry,
);

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
TopologyRackSchema.index(
  { id: 1 },
  { unique: true, name: 'uq_asset_topology_rack_id' },
);
TopologyRackLocationSchema.index(
  { rackId: 1, validFrom: -1 },
  { name: 'ix_asset_topology_rack_location_history' },
);
TopologyRackLocationSchema.index(
  { rackId: 1 },
  {
    unique: true,
    partialFilterExpression: { validTo: { $exists: false } },
    name: 'uq_asset_topology_active_rack_location',
  },
);
TopologyRackLocationSchema.index(
  { roomId: 1, column: 1, row: 1 },
  {
    unique: true,
    partialFilterExpression: { validTo: { $exists: false } },
    name: 'uq_asset_topology_active_room_cell',
  },
);
TopologyRoomSchema.index(
  { siteId: 1, name: 1 },
  { name: 'ix_asset_topology_room_site_name' },
);

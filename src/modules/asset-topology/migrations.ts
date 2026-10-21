import { DEFAULT_DATA_CENTER_MIGRATION } from './infrastructure/mongodb/migrations/default-data-center.migration';
import { ASSET_CATALOG_MIGRATION } from './infrastructure/mongodb/migrations/asset-catalog.migration';
import { RACK_MANAGEMENT_MIGRATION } from './infrastructure/mongodb/migrations/rack-management.migration';
import { ASSET_PLACEMENT_MIGRATION } from './infrastructure/mongodb/migrations/asset-placement.migration';
import { QR_MAPPING_MIGRATION } from './infrastructure/mongodb/migrations/qr-mapping.migration';
import { ROOM_WALKWAY_LAYOUT_MIGRATION } from './infrastructure/mongodb/migrations/room-walkway-layout.migration';
import { ROOM_WALKWAY_CELL_IDS_MIGRATION } from './infrastructure/mongodb/migrations/room-walkway-cell-ids.migration';
import { RACK_NAME_LOCATION_LABEL_MIGRATION } from './infrastructure/mongodb/migrations/rack-name-location-label.migration';

/** Asset & Topology-owned MongoDB migrations exposed to the application host. */
export const ASSET_TOPOLOGY_MONGO_MIGRATIONS = [
  DEFAULT_DATA_CENTER_MIGRATION,
  ASSET_CATALOG_MIGRATION,
  RACK_MANAGEMENT_MIGRATION,
  ASSET_PLACEMENT_MIGRATION,
  QR_MAPPING_MIGRATION,
  ROOM_WALKWAY_LAYOUT_MIGRATION,
  ROOM_WALKWAY_CELL_IDS_MIGRATION,
  RACK_NAME_LOCATION_LABEL_MIGRATION,
] as const;

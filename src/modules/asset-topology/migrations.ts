import { DEFAULT_DATA_CENTER_MIGRATION } from './infrastructure/mongodb/migrations/default-data-center.migration';
import { ASSET_CATALOG_MIGRATION } from './infrastructure/mongodb/migrations/asset-catalog.migration';
import { RACK_MANAGEMENT_MIGRATION } from './infrastructure/mongodb/migrations/rack-management.migration';

/** Asset & Topology-owned MongoDB migrations exposed to the application host. */
export const ASSET_TOPOLOGY_MONGO_MIGRATIONS = [
  DEFAULT_DATA_CENTER_MIGRATION,
  ASSET_CATALOG_MIGRATION,
  RACK_MANAGEMENT_MIGRATION,
] as const;

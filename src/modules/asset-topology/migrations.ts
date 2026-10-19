import { DEFAULT_DATA_CENTER_MIGRATION } from './infrastructure/mongodb/migrations/default-data-center.migration';

/** Asset & Topology-owned MongoDB migrations exposed to the application host. */
export const ASSET_TOPOLOGY_MONGO_MIGRATIONS = [
  DEFAULT_DATA_CENTER_MIGRATION,
] as const;

import { IAM_MONGO_MIGRATIONS } from '@modules/iam/migrations';
import { ASSET_TOPOLOGY_MONGO_MIGRATIONS } from '@modules/asset-topology/migrations';
import type { MongoMigration } from '@platform/database/mongodb/migrations/mongo-migration';

// Export the migrations here. The order of the migrations in this array does not matter; they will be sorted by ID before being run.
// Import the migrations from their respective modules and add them to this array.
export const APPLICATION_MONGO_MIGRATIONS: readonly MongoMigration[] = [
  ...IAM_MONGO_MIGRATIONS,
  ...ASSET_TOPOLOGY_MONGO_MIGRATIONS,
];

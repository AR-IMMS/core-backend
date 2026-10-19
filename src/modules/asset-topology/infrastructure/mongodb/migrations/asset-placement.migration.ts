import type { MongoMigration } from '@platform/database/mongodb/migrations';

/** Enforces one active Asset placement and one occupant per Rack U. */
export const ASSET_PLACEMENT_MIGRATION: MongoMigration = {
  id: '20261020T010000Z_asset_topology_asset_placement',
  module: 'asset-topology',
  description: 'Create Asset Location history and active-placement indexes',
  async up(connection) {
    const database = connection.db;
    if (!database)
      throw new Error('MongoDB connection has no active database.');
    const locations = database.collection('asset_topology_asset_locations');
    await Promise.all([
      locations.createIndex(
        { id: 1 },
        { unique: true, name: 'uq_asset_topology_asset_location_id' },
      ),
      locations.createIndex(
        { assetId: 1 },
        {
          unique: true,
          partialFilterExpression: { validTo: { $exists: false } },
          name: 'uq_asset_topology_active_asset_location',
        },
      ),
      locations.createIndex(
        { rackId: 1, uPosition: 1 },
        {
          unique: true,
          partialFilterExpression: { validTo: { $exists: false } },
          name: 'uq_asset_topology_active_rack_u_occupant',
        },
      ),
      locations.createIndex(
        { assetId: 1, validFrom: 1, id: 1 },
        { name: 'ix_asset_topology_asset_location_history' },
      ),
    ]);
  },
};

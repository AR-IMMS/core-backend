import type { MongoMigration } from '@platform/database/mongodb/migrations';

/** Adds Rack identity and active-cell uniqueness indexes. */
export const RACK_MANAGEMENT_MIGRATION: MongoMigration = {
  id: '20261019T020000Z_asset_topology_rack_management',
  module: 'asset-topology',
  description: 'Create Rack and Room-map location indexes',
  async up(connection) {
    const database = connection.db;
    if (!database)
      throw new Error('MongoDB connection has no active database.');
    await Promise.all([
      database
        .collection('asset_topology_racks')
        .createIndex(
          { id: 1 },
          { unique: true, name: 'uq_asset_topology_rack_id' },
        ),
      database.collection('asset_topology_rack_locations').createIndex(
        { rackId: 1 },
        {
          unique: true,
          partialFilterExpression: { validTo: { $exists: false } },
          name: 'uq_asset_topology_active_rack_location',
        },
      ),
      database.collection('asset_topology_rack_locations').createIndex(
        { roomId: 1, column: 1, row: 1 },
        {
          unique: true,
          partialFilterExpression: { validTo: { $exists: false } },
          name: 'uq_asset_topology_active_room_cell',
        },
      ),
      database
        .collection('asset_topology_rack_locations')
        .createIndex(
          { rackId: 1, validFrom: -1 },
          { name: 'ix_asset_topology_rack_location_history' },
        ),
    ]);
  },
};

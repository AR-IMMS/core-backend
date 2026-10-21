import type { MongoMigration } from '@platform/database/mongodb/migrations';

/** Removes generated MongoDB IDs from the Room's coordinate-only walkway cells. */
export const ROOM_WALKWAY_CELL_IDS_MIGRATION: MongoMigration = {
  id: '20261021T010000Z_asset_topology_remove_walkway_cell_ids',
  module: 'asset-topology',
  description: 'Remove generated IDs from Room walkway cells',
  async up(connection) {
    const database = connection.db;
    if (!database)
      throw new Error('MongoDB connection has no active database.');
    await database
      .collection('asset_topology_rooms')
      .updateMany(
        { 'walkwayCells._id': { $exists: true } },
        { $unset: { 'walkwayCells.$[cell]._id': '' } },
        { arrayFilters: [{ 'cell._id': { $exists: true } }] },
      );
  },
};

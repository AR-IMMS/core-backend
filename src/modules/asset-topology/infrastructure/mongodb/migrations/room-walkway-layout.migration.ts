import type { MongoMigration } from '@platform/database/mongodb/migrations';

/** Backfills sparse walkway configuration and the Room layout revision token. */
export const ROOM_WALKWAY_LAYOUT_MIGRATION: MongoMigration = {
  id: '20261021T000000Z_asset_topology_room_walkway_layout',
  module: 'asset-topology',
  description: 'Add Room walkway cells and layout revision defaults',
  async up(connection) {
    const database = connection.db;
    if (!database)
      throw new Error('MongoDB connection has no active database.');
    const rooms = database.collection('asset_topology_rooms');
    await Promise.all([
      rooms.updateMany(
        { walkwayCells: { $exists: false } },
        { $set: { walkwayCells: [] } },
      ),
      rooms.updateMany(
        { layoutRevision: { $exists: false } },
        { $set: { layoutRevision: 0 } },
      ),
    ]);
  },
};

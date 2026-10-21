import type { MongoMigration } from '@platform/database/mongodb/migrations';

/** Backfills required Rack names and removes stored display-label metadata. */
export const RACK_NAME_LOCATION_LABEL_MIGRATION: MongoMigration = {
  id: '20261021T020000Z_asset_topology_rack_name_location_label',
  module: 'asset-topology',
  description: 'Require Rack names and derive labels from location',
  async up(connection) {
    const database = connection.db;
    if (!database)
      throw new Error('MongoDB connection has no active database.');
    await database
      .collection('asset_topology_racks')
      .updateMany({}, [
        { $set: { name: { $ifNull: ['$name', '$id'] } } },
        { $unset: ['rowLabel', 'positionInRow'] },
      ]);
  },
};

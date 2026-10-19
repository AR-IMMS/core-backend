import type { MongoMigration } from '@platform/database/mongodb/migrations';
import { DEFAULT_DATA_CENTER_ID } from '../../../domain/topology/data-center';

/** Creates topology lookup indexes and provisions the stable default Data Center. */
export const DEFAULT_DATA_CENTER_MIGRATION: MongoMigration = {
  id: '20261019T000000Z_asset_topology_default_data_center',
  module: 'asset-topology',
  description: 'Provision the default Data Center and topology indexes',

  async up(connection) {
    const database = connection.db;
    if (!database)
      throw new Error('MongoDB connection has no active database.');

    const dataCenters = database.collection('asset_topology_data_centers');
    const sites = database.collection('asset_topology_sites');
    const rooms = database.collection('asset_topology_rooms');

    await Promise.all([
      dataCenters.createIndex(
        { id: 1 },
        { unique: true, name: 'uq_asset_topology_data_center_id' },
      ),
      sites.createIndex(
        { id: 1 },
        { unique: true, name: 'uq_asset_topology_site_id' },
      ),
      sites.createIndex(
        { dataCenterId: 1, name: 1 },
        { name: 'ix_asset_topology_site_data_center_name' },
      ),
      rooms.createIndex(
        { id: 1 },
        { unique: true, name: 'uq_asset_topology_room_id' },
      ),
      rooms.createIndex(
        { siteId: 1, name: 1 },
        { name: 'ix_asset_topology_room_site_name' },
      ),
    ]);

    await dataCenters.updateOne(
      { id: DEFAULT_DATA_CENTER_ID },
      {
        $setOnInsert: {
          id: DEFAULT_DATA_CENTER_ID,
          name: 'Default Data Center',
        },
      },
      { upsert: true },
    );
  },
};

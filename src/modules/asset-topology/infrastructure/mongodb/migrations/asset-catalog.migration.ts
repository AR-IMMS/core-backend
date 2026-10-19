import type { MongoMigration } from '@platform/database/mongodb/migrations';

/** Creates Asset registry indexes and provisions the required Node Type. */
export const ASSET_CATALOG_MIGRATION: MongoMigration = {
  id: '20261019T010000Z_asset_topology_asset_catalog',
  module: 'asset-topology',
  description: 'Provision the Node Asset Type and Asset registry indexes',
  async up(connection) {
    const database = connection.db;
    if (!database)
      throw new Error('MongoDB connection has no active database.');

    const types = database.collection('asset_topology_asset_types');
    const models = database.collection('asset_topology_asset_models');
    const assets = database.collection('asset_topology_assets');
    await Promise.all([
      types.createIndex(
        { id: 1 },
        { unique: true, name: 'uq_asset_topology_asset_type_id' },
      ),
      models.createIndex(
        { id: 1 },
        { unique: true, name: 'uq_asset_topology_asset_model_id' },
      ),
      assets.createIndex(
        { id: 1 },
        { unique: true, name: 'uq_asset_topology_asset_id' },
      ),
    ]);
    await types.updateOne(
      { id: 'type-node' },
      { $setOnInsert: { id: 'type-node', name: 'Node' } },
      { upsert: true },
    );
  },
};

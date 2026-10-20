import type { MongoMigration } from '@platform/database/mongodb/migrations';

/** Creates permanent QR-value and active-target uniqueness indexes. */
export const QR_MAPPING_MIGRATION: MongoMigration = {
  id: '20261020T120000Z_asset_topology_qr_mapping',
  module: 'asset-topology',
  description: 'Create historical QR mapping and active uniqueness indexes',
  async up(connection) {
    const database = connection.db;
    if (!database)
      throw new Error('MongoDB connection has no active database.');
    const collection = database.collection('asset_topology_qr_mappings');
    await Promise.all([
      collection.createIndex(
        { id: 1 },
        { unique: true, name: 'uq_asset_topology_qr_mapping_id' },
      ),
      collection.createIndex(
        { value: 1 },
        { unique: true, name: 'uq_asset_topology_qr_value_history' },
      ),
      collection.createIndex(
        { targetType: 1, targetId: 1 },
        {
          unique: true,
          partialFilterExpression: { active: true },
          name: 'uq_asset_topology_active_qr_per_target',
        },
      ),
      collection.createIndex(
        { targetType: 1, targetId: 1, validFrom: -1 },
        { name: 'ix_asset_topology_qr_mapping_history' },
      ),
    ]);
  },
};

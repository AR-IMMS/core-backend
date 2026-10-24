import { ASSET_CATALOG_MIGRATION } from '../asset-catalog.migration';

describe('ASSET_CATALOG_MIGRATION', () => {
  it('creates registry indexes and idempotently seeds the Node Type', async () => {
    const updateOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    const collection = {
      createIndex: jest.fn().mockResolvedValue('created'),
      updateOne,
    };
    const connection = {
      db: { collection: jest.fn(() => collection) },
    } as never;

    await ASSET_CATALOG_MIGRATION.up(connection);
    await ASSET_CATALOG_MIGRATION.up(connection);

    expect(updateOne).toHaveBeenCalledTimes(2);
    expect(updateOne).toHaveBeenCalledWith(
      { id: 'type-node' },
      { $setOnInsert: { id: 'type-node', name: 'Node' } },
      { upsert: true },
    );
    expect(collection.createIndex).toHaveBeenCalledTimes(6);
  });
});

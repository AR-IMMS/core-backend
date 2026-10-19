/* eslint-disable @typescript-eslint/no-unsafe-member-access -- The migration is tested against a minimal structural Mongo connection double. */
import { DEFAULT_DATA_CENTER_ID } from '../../../../domain/topology/data-center';
import { DEFAULT_DATA_CENTER_MIGRATION } from '.././default-data-center.migration';

describe('DEFAULT_DATA_CENTER_MIGRATION', () => {
  it('uses an idempotent insert-only upsert for the default Data Center', async () => {
    const updateOne = jest.fn().mockResolvedValue({ upsertedCount: 1 });
    const collection = {
      createIndex: jest.fn().mockResolvedValue('created'),
      updateOne,
    };
    const connection = {
      db: { collection: jest.fn(() => collection) },
    } as never;

    await DEFAULT_DATA_CENTER_MIGRATION.up(connection);
    await DEFAULT_DATA_CENTER_MIGRATION.up(connection);

    expect(connection.db.collection).toHaveBeenCalledWith(
      'asset_topology_data_centers',
    );
    expect(updateOne).toHaveBeenCalledTimes(2);
    expect(updateOne).toHaveBeenCalledWith(
      { id: DEFAULT_DATA_CENTER_ID },
      {
        $setOnInsert: {
          id: DEFAULT_DATA_CENTER_ID,
          name: 'Default Data Center',
        },
      },
      { upsert: true },
    );
    expect(collection.createIndex).toHaveBeenCalledTimes(10);
  });
});

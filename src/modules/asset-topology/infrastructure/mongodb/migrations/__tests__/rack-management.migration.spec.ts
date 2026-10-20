import { RACK_MANAGEMENT_MIGRATION } from '../rack-management.migration';

describe('RACK_MANAGEMENT_MIGRATION', () => {
  it('creates unique active Rack-location and Room-cell indexes', async () => {
    const createIndex = jest.fn().mockResolvedValue('created');
    const collection = { createIndex };
    const connection = {
      db: { collection: jest.fn(() => collection) },
    } as never;

    await RACK_MANAGEMENT_MIGRATION.up(connection);

    expect(createIndex).toHaveBeenCalledWith(
      { roomId: 1, column: 1, row: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { validTo: null },
        name: 'uq_asset_topology_active_room_cell',
      }),
    );
    expect(createIndex).toHaveBeenCalledWith(
      { rackId: 1 },
      expect.objectContaining({
        name: 'uq_asset_topology_active_rack_location',
        unique: true,
      }),
    );
  });
});

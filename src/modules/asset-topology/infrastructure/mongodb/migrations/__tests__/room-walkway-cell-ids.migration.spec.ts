import { ROOM_WALKWAY_CELL_IDS_MIGRATION } from '../room-walkway-cell-ids.migration';

describe('ROOM_WALKWAY_CELL_IDS_MIGRATION', () => {
  it('removes generated IDs while preserving walkway coordinates', async () => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const connection = {
      db: { collection: jest.fn(() => ({ updateMany })) },
    } as never;

    await ROOM_WALKWAY_CELL_IDS_MIGRATION.up(connection);

    expect(updateMany).toHaveBeenCalledWith(
      { 'walkwayCells._id': { $exists: true } },
      { $unset: { 'walkwayCells.$[cell]._id': '' } },
      { arrayFilters: [{ 'cell._id': { $exists: true } }] },
    );
  });
});

import { ROOM_WALKWAY_LAYOUT_MIGRATION } from '../room-walkway-layout.migration';

describe('ROOM_WALKWAY_LAYOUT_MIGRATION', () => {
  it('backfills only missing Room walkway and revision fields', async () => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 2 });
    const collection = { updateMany };
    const connection = {
      db: { collection: jest.fn(() => collection) },
    } as never;

    await ROOM_WALKWAY_LAYOUT_MIGRATION.up(connection);

    expect(updateMany).toHaveBeenCalledWith(
      { walkwayCells: { $exists: false } },
      { $set: { walkwayCells: [] } },
    );
    expect(updateMany).toHaveBeenCalledWith(
      { layoutRevision: { $exists: false } },
      { $set: { layoutRevision: 0 } },
    );
  });
});

import { RACK_NAME_LOCATION_LABEL_MIGRATION } from '../rack-name-location-label.migration';

describe('RACK_NAME_LOCATION_LABEL_MIGRATION', () => {
  it('backfills missing names from Rack IDs and removes stored labels', async () => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const connection = {
      db: { collection: jest.fn(() => ({ updateMany })) },
    } as never;

    await RACK_NAME_LOCATION_LABEL_MIGRATION.up(connection);

    expect(updateMany).toHaveBeenCalledWith({}, [
      { $set: { name: { $ifNull: ['$name', '$id'] } } },
      { $unset: ['rowLabel', 'positionInRow'] },
    ]);
  });
});

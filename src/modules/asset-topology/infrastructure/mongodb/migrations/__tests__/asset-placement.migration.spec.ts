import { ASSET_PLACEMENT_MIGRATION } from '../asset-placement.migration';

describe('ASSET_PLACEMENT_MIGRATION', () => {
  it('enforces active Asset and Rack U uniqueness and supports history reads', async () => {
    const createIndex = jest.fn().mockResolvedValue('created');
    const connection = {
      db: { collection: jest.fn(() => ({ createIndex })) },
    } as never;

    await ASSET_PLACEMENT_MIGRATION.up(connection);

    expect(createIndex).toHaveBeenCalledWith(
      { assetId: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { validTo: null },
        name: 'uq_asset_topology_active_asset_location',
      }),
    );
    expect(createIndex).toHaveBeenCalledWith(
      { rackId: 1, uPosition: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { validTo: null },
        name: 'uq_asset_topology_active_rack_u_occupant',
      }),
    );
    expect(createIndex).toHaveBeenCalledWith(
      { assetId: 1, validFrom: 1, id: 1 },
      expect.objectContaining({
        name: 'ix_asset_topology_asset_location_history',
      }),
    );
  });
});

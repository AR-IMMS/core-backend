import { QR_MAPPING_MIGRATION } from '../qr-mapping.migration';

describe('QR_MAPPING_MIGRATION', () => {
  it('enforces globally unique QR history and one active QR per target', async () => {
    const createIndex = jest.fn().mockResolvedValue('created');
    const connection = {
      db: { collection: jest.fn(() => ({ createIndex })) },
    } as never;
    await QR_MAPPING_MIGRATION.up(connection);
    expect(createIndex).toHaveBeenCalledWith(
      { value: 1 },
      { unique: true, name: 'uq_asset_topology_qr_value_history' },
    );
    expect(createIndex).toHaveBeenCalledWith(
      { targetType: 1, targetId: 1 },
      {
        unique: true,
        partialFilterExpression: { active: true },
        name: 'uq_asset_topology_active_qr_per_target',
      },
    );
  });
});

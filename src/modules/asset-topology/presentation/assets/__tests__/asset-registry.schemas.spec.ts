import { registerAssetSchema } from '../asset-registry.schemas';

describe('Asset registry request schemas', () => {
  it('accepts the NODE enum for registration', () => {
    expect(
      registerAssetSchema.safeParse({ name: 'Node 01', asset_type: 'NODE' })
        .success,
    ).toBe(true);
  });

  it('rejects catalog IDs and unsupported Asset Type enum values', () => {
    expect(
      registerAssetSchema.safeParse({
        name: 'Node 01',
        asset_type_id: 'type-node',
      }).success,
    ).toBe(false);
    expect(
      registerAssetSchema.safeParse({ name: 'Unknown', asset_type: 'SERVER' })
        .success,
    ).toBe(false);
  });
});

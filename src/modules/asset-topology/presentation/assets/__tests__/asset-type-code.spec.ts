import { assetTypeCodeFromId, assetTypeIdFromCode } from '../asset-type-code';

describe('Asset Type API mapping', () => {
  it('maps the public NODE enum to the stable internal catalog ID', () => {
    expect(assetTypeIdFromCode('NODE')).toBe('type-node');
    expect(assetTypeCodeFromId('type-node')).toBe('NODE');
  });

  it('rejects internal Type IDs that have no public enum mapping', () => {
    expect(() => assetTypeCodeFromId('type-unknown')).toThrow(
      'Asset Type ID "type-unknown" has no public API mapping.',
    );
  });
});

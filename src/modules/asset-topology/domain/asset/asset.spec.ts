import { Asset } from './asset';
import { DomainError } from '../shared/domain-error';

describe('Asset', () => {
  const nodeType = { id: 'type-node' };

  it('registers an Asset with a name and stable identity', () => {
    const asset = Asset.register({
      id: 'asset-1',
      name: 'Node 01',
      type: nodeType,
    });

    expect(asset.id).toBe('asset-1');
    expect(asset.name).toBe('Node 01');
    expect(asset.assetTypeId).toBe('type-node');
  });

  it('rejects a blank Asset name', () => {
    expect(() =>
      Asset.register({
        id: 'asset-1',
        name: '  ',
        type: nodeType,
      }),
    ).toThrow(DomainError);
  });

  it('rejects a Model that belongs to a different Asset Type', () => {
    expect(() =>
      Asset.register({
        id: 'asset-1',
        name: 'Node 01',
        type: nodeType,
        model: {
          id: 'model-switch',
          assetTypeId: 'type-network-device',
        },
      }),
    ).toThrow('Asset Model must belong to the Asset Type');
  });

  it('keeps the same ID when the display name changes', () => {
    const asset = Asset.register({
      id: 'asset-1',
      name: 'Node 01',
      type: nodeType,
    });

    const renamed = asset.rename('Node A01');

    expect(renamed.id).toBe('asset-1');
    expect(renamed.name).toBe('Node A01');
  });
});

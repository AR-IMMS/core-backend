import { Asset } from '.././asset';
import { DomainError } from '../../shared/domain-error';

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

  it('starts ACTIVE and updates descriptions without changing ID or Type', () => {
    const asset = Asset.register({
      id: 'asset-1',
      name: 'Node 01',
      type: nodeType,
    });

    const updated = asset.updateDescription({
      name: 'Node A01',
      model: { id: 'model-1', assetTypeId: 'type-node' },
      serialNumber: ' serial-1 ',
    });

    expect(asset.lifecycleState).toBe('ACTIVE');
    expect(updated).toMatchObject({
      id: 'asset-1',
      name: 'Node A01',
      assetTypeId: 'type-node',
      assetModelId: 'model-1',
      serialNumber: 'serial-1',
      lifecycleState: 'ACTIVE',
    });
  });

  it('allows clearing optional Model and serial values', () => {
    const asset = Asset.register({
      id: 'asset-1',
      name: 'Node 01',
      type: nodeType,
      model: { id: 'model-1', assetTypeId: 'type-node' },
      serialNumber: 'serial-1',
    });

    const updated = asset.updateDescription({
      model: null,
      serialNumber: '   ',
    });

    expect(updated.assetModelId).toBeUndefined();
    expect(updated.serialNumber).toBeUndefined();
    expect(updated.assetTypeId).toBe('type-node');
  });

  it('preserves optional Model and serial values when fields are omitted', () => {
    const asset = Asset.register({
      id: 'asset-1',
      name: 'Node 01',
      type: nodeType,
      model: { id: 'model-1', assetTypeId: 'type-node' },
      serialNumber: 'serial-1',
    });

    const updated = asset.updateDescription({ name: 'Renamed' });

    expect(updated.assetModelId).toBe('model-1');
    expect(updated.serialNumber).toBe('serial-1');
  });

  it('rejects blank names and Models of another Type on update', () => {
    const asset = Asset.register({
      id: 'asset-1',
      name: 'Node 01',
      type: nodeType,
    });

    expect(() => asset.updateDescription({ name: '  ' })).toThrow(DomainError);
    expect(() =>
      asset.updateDescription({
        model: { id: 'model-1', assetTypeId: 'type-server' },
      }),
    ).toThrow('Asset Model must belong to the Asset Type');
  });
});

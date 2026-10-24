/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment -- Jest mocks expose dynamic call records. */
import type { OutboxWriterPort, UnitOfWorkPort } from '@platform/events';
import type {
  AssetTopologyAssetQueries,
  AssetTopologyRackQueries,
} from '../../../contracts';
import type { QrMappingStorePort } from '../qr-mapping-store.port';
import type { AssetStorePort } from '../../assets/asset-store.port';
import type { RackStorePort } from '../../racks/rack-store.port';
import { QrMappingUseCases } from '../qr-mapping.use-cases';

describe('QrMappingUseCases', () => {
  const actor = { type: 'user', id: 'admin-1' };
  const now = new Date('2026-10-20T12:00:00.000Z');
  let store: jest.Mocked<QrMappingStorePort>;
  let assets: jest.Mocked<AssetTopologyAssetQueries>;
  let racks: jest.Mocked<AssetTopologyRackQueries>;
  let outbox: jest.Mocked<OutboxWriterPort>;
  let useCases: QrMappingUseCases;
  let assetStore: jest.Mocked<AssetStorePort>;
  let rackStore: jest.Mocked<RackStorePort>;

  beforeEach(() => {
    store = {
      getActiveForTarget: jest.fn().mockResolvedValue(null),
      findActiveByValue: jest.fn(),
      replaceActive: jest.fn().mockResolvedValue(undefined),
      deactivateActive: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<QrMappingStorePort>;
    assets = {
      getAsset: jest.fn().mockResolvedValue({
        id: 'asset-1',
        name: 'Node 01',
        assetTypeId: 'type-node',
        lifecycleState: 'ACTIVE',
        currentPlacement: null,
      }),
      getAssetPlacementHistory: jest.fn(),
    } as unknown as jest.Mocked<AssetTopologyAssetQueries>;
    racks = {
      getRack: jest.fn().mockResolvedValue({
        id: 'rack-1',
        uCapacity: 42,
        currentLocation: null,
      }),
      getRoomMap: jest.fn(),
      getRackLocationHistory: jest.fn(),
    } as unknown as jest.Mocked<AssetTopologyRackQueries>;
    outbox = {
      append: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<OutboxWriterPort>;
    assetStore = {
      findById: jest.fn(),
      save: jest.fn().mockResolvedValue(2),
      list: jest.fn(),
    } as unknown as jest.Mocked<AssetStorePort>;
    rackStore = {
      getRack: jest.fn(),
      saveRack: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<RackStorePort>;
    const unitOfWork: UnitOfWorkPort = {
      run: (operation) => operation({} as never),
    };
    useCases = new QrMappingUseCases(
      store,
      assets,
      racks,
      unitOfWork,
      outbox,
      () => now,
      () => 'opaque-qr-value',
      () => 'mapping-1',
      assetStore,
      rackStore,
    );
  });

  it('generates an opaque value, replaces the target mapping, and audits the change', async () => {
    store.getActiveForTarget.mockResolvedValue({
      id: 'mapping-old',
      value: 'old-value',
      targetType: 'rack',
      targetId: 'rack-1',
      active: true,
    });

    const mapping = await useCases.assign('rack', 'rack-1', actor);

    expect(mapping.value).toBe('opaque-qr-value');
    expect(store.replaceActive).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'opaque-qr-value', targetId: 'rack-1' }),
      expect.anything(),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        occurred_at: now.toISOString(),
        payload: expect.objectContaining({
          action: 'asset_topology.qr_mapping.replaced',
          changes: expect.arrayContaining([
            { field: 'qr_mapping_source', after: 'manual' },
            {
              field: 'qr_value',
              before: 'old-value',
              after: 'opaque-qr-value',
            },
          ]),
        }),
      }),
      expect.anything(),
    );
  });

  it('generates an Asset mapping through the same target-owned query path', async () => {
    const mapping = await useCases.assign('asset', 'asset-1', actor);

    expect(mapping).toMatchObject({
      value: 'opaque-qr-value',
      targetType: 'asset',
      targetId: 'asset-1',
    });
    expect(assets.getAsset).toHaveBeenCalledWith('asset-1');
    expect(assetStore.save).toHaveBeenCalled();
  });

  it('resolves only an active QR and returns current target data from its query', async () => {
    store.findActiveByValue.mockResolvedValue({
      id: 'mapping-1',
      value: 'opaque-qr-value',
      targetType: 'asset',
      targetId: 'asset-1',
      active: true,
    });

    await expect(useCases.resolve('opaque-qr-value')).resolves.toEqual({
      target_type: 'asset',
      target_id: 'asset-1',
      target: await assets.getAsset('asset-1' as never),
    });
    expect(assets.getAsset).toHaveBeenCalledWith('asset-1');
  });

  it('returns the Rack current query data for a Rack mapping', async () => {
    store.findActiveByValue.mockResolvedValue({
      id: 'mapping-1',
      value: 'opaque',
      targetType: 'rack',
      targetId: 'rack-1',
      active: true,
    });
    await expect(useCases.resolve('opaque')).resolves.toMatchObject({
      target_type: 'rack',
      target: { id: 'rack-1' },
    });
    expect(racks.getRack).toHaveBeenCalledWith('rack-1');
  });

  it('does not resolve a QR with no active mapping', async () => {
    store.findActiveByValue.mockResolvedValue(null);

    await expect(useCases.resolve('old-value')).resolves.toBeNull();
    expect(assets.getAsset).not.toHaveBeenCalled();
    expect(racks.getRack).not.toHaveBeenCalled();
  });

  it('deactivates the current mapping and emits an attributed Audit Fact', async () => {
    store.getActiveForTarget.mockResolvedValue({
      id: 'mapping-1',
      value: 'opaque-qr-value',
      targetType: 'rack',
      targetId: 'rack-1',
      active: true,
    });

    await useCases.deactivate('rack', 'rack-1', actor);

    expect(store.deactivateActive).toHaveBeenCalledWith(
      'rack',
      'rack-1',
      expect.anything(),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          action: 'asset_topology.qr_mapping.deactivated',
          changes: expect.arrayContaining([
            { field: 'qr_mapping_source', after: 'manual' },
            { field: 'qr_value', before: 'opaque-qr-value', after: null },
          ]),
        }),
      }),
      expect.anything(),
    );
  });
});

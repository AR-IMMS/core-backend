import { Asset } from '../../../domain/asset/asset';
import { AssetPlacement } from '../../../domain/placement/asset-placement';
import { GetAssetUseCase, ListAssetsUseCase } from '../asset-query.use-case';

describe('Asset query use cases', () => {
  it('reports enrollment eligibility from Asset lifecycle and current placement', async () => {
    const active = Asset.register({
      id: 'asset-active',
      name: 'Node',
      type: { id: 'node' },
    });
    const retired = Asset.restore({
      id: 'asset-retired',
      name: 'Retired',
      assetTypeId: 'node',
      lifecycleState: 'RETIRED',
    });
    const assets = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(active)
        .mockResolvedValueOnce(retired)
        .mockResolvedValueOnce(null),
    };
    const placements = {
      findActiveByAsset: jest
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce(null),
    };
    const useCase = new GetAssetUseCase(assets as never, placements as never);

    await expect(
      useCase.getAgentEnrollmentNodeEligibility('asset-active' as never),
    ).resolves.toEqual({
      exists: true,
      active: true,
      hasActivePlacement: true,
    });
    await expect(
      useCase.getAgentEnrollmentNodeEligibility('asset-retired' as never),
    ).resolves.toEqual({
      exists: true,
      active: false,
      hasActivePlacement: false,
    });
    await expect(
      useCase.getAgentEnrollmentNodeEligibility('missing' as never),
    ).resolves.toEqual({
      exists: false,
      active: false,
      hasActivePlacement: false,
    });
  });

  it('returns canonical Asset facts with null placement and null for an absent Asset', async () => {
    const asset = Asset.register({
      id: 'asset-1',
      name: 'Node',
      type: { id: 'type-node' },
    });
    const store = {
      findById: jest
        .fn()
        .mockResolvedValueOnce(asset)
        .mockResolvedValueOnce(null),
    };
    const placements = {
      findActiveByAsset: jest.fn().mockResolvedValue(null),
      listHistoryByAsset: jest.fn().mockResolvedValue([]),
    };
    const useCase = new GetAssetUseCase(store as never, placements as never);

    await expect(useCase.execute('asset-1' as never)).resolves.toMatchObject({
      id: 'asset-1',
      name: 'Node',
      assetTypeId: 'type-node',
      lifecycleState: 'ACTIVE',
      currentPlacement: null,
    });
    await expect(useCase.execute('missing' as never)).resolves.toBeNull();
  });

  it('forwards a cursor page size and returns a next cursor only when more Assets exist', async () => {
    const assets = [
      Asset.register({ id: 'asset-1', name: 'A', type: { id: 'type-node' } }),
      Asset.register({ id: 'asset-2', name: 'B', type: { id: 'type-node' } }),
    ];
    const store = {
      list: jest.fn().mockResolvedValue({ items: assets, hasMore: true }),
    };
    const placements = {
      listActiveByAssetIds: jest.fn().mockResolvedValue([]),
      listActiveAssetIdsByRack: jest.fn().mockResolvedValue(['asset-1']),
    };
    const useCase = new ListAssetsUseCase(store as never, placements as never);

    const page = await useCase.execute({
      pageSize: 1,
      afterAssetId: 'asset-0',
    });

    expect(store.list).toHaveBeenCalledWith({
      afterAssetId: 'asset-0',
      limit: 1,
    });
    expect(page.nextCursorAssetId).toBe('asset-2');
    expect(placements.listActiveByAssetIds).toHaveBeenCalledWith([
      'asset-1',
      'asset-2',
    ]);
  });

  it('combines Rack, Type, lifecycle, and text filters with cursor pagination', async () => {
    const store = {
      list: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    const placements = {
      listActiveAssetIdsByRack: jest.fn().mockResolvedValue(['asset-1']),
      listActiveByAssetIds: jest.fn().mockResolvedValue([]),
    };
    const useCase = new ListAssetsUseCase(store as never, placements as never);

    await useCase.execute({
      pageSize: 20,
      afterAssetId: 'asset-0',
      assetTypeId: 'type-node',
      lifecycleState: 'ACTIVE',
      rackId: 'rack-1',
      search: 'node',
    });

    expect(placements.listActiveAssetIdsByRack).toHaveBeenCalledWith('rack-1');
    expect(store.list).toHaveBeenCalledWith({
      afterAssetId: 'asset-0',
      limit: 20,
      assetTypeId: 'type-node',
      lifecycleState: 'ACTIVE',
      assetIds: ['asset-1'],
      search: 'node',
    });
  });

  it('returns the confirmed active Rack U placement on the Asset reference', async () => {
    const asset = Asset.register({
      id: 'asset-1',
      name: 'Node',
      type: { id: 'type-node' },
    });
    const activePlacement = AssetPlacement.start({
      id: 'location-1',
      assetId: 'asset-1',
      rackId: 'rack-1',
      uPosition: 8,
      placedAt: new Date('2026-10-20T00:00:00.000Z'),
    });
    const assets = { findById: jest.fn().mockResolvedValue(asset) };
    const placements = {
      findActiveByAsset: jest.fn().mockResolvedValue(activePlacement),
      listHistoryByAsset: jest.fn().mockResolvedValue([activePlacement]),
    };
    const useCase = new GetAssetUseCase(assets as never, placements as never);

    await expect(useCase.execute('asset-1' as never)).resolves.toMatchObject({
      currentPlacement: { rackId: 'rack-1', uPosition: 8 },
    });
    await expect(
      useCase.getAssetPlacementHistory('asset-1' as never),
    ).resolves.toEqual([
      {
        rackId: 'rack-1',
        uPosition: 8,
        validFrom: '2026-10-20T00:00:00.000Z',
        validTo: null,
      },
    ]);
  });
});

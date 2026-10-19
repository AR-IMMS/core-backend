import { Asset } from '../../../domain/asset/asset';
import { AssetPlacement } from '../../../domain/placement/asset-placement';
import { GetAssetUseCase, ListAssetsUseCase } from '../asset-query.use-case';

describe('Asset query use cases', () => {
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

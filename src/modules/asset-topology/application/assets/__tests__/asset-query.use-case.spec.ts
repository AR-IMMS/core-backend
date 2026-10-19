import { Asset } from '../../../domain/asset/asset';
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
    const useCase = new GetAssetUseCase(store as never);

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
    const useCase = new ListAssetsUseCase(store as never);

    const page = await useCase.execute({
      pageSize: 1,
      afterAssetId: 'asset-0',
    });

    expect(store.list).toHaveBeenCalledWith({
      afterAssetId: 'asset-0',
      limit: 1,
    });
    expect(page.nextCursorAssetId).toBe('asset-2');
  });
});

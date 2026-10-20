/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Jest call records and generic UoW callback use dynamic mock signatures. */
import { Asset } from '../../../domain/asset/asset';
import { RegisterAssetUseCase } from '../asset-registration.use-case';
import { UpdateAssetUseCase } from '../asset-update.use-case';

describe('Asset registry write use cases', () => {
  const context = {} as never;
  let assets: { save: jest.Mock; findById: jest.Mock; list: jest.Mock };
  let catalog: { findType: jest.Mock; findModel: jest.Mock };
  let outbox: { append: jest.Mock };
  let unitOfWork: { run: jest.Mock };
  const actor = { type: 'user', id: 'admin-1' };

  beforeEach(() => {
    assets = {
      save: jest.fn().mockResolvedValue(1),
      findById: jest.fn(),
      list: jest.fn(),
    };
    catalog = {
      findType: jest.fn().mockResolvedValue({ id: 'type-node' }),
      findModel: jest
        .fn()
        .mockResolvedValue({ id: 'model-1', assetTypeId: 'type-node' }),
    };
    outbox = { append: jest.fn().mockResolvedValue(undefined) };
    unitOfWork = { run: jest.fn((callback) => callback(context)) };
  });

  it('registers ACTIVE Assets with canonical identity and appends an Audit fact', async () => {
    const useCase = new RegisterAssetUseCase(
      assets,
      catalog,
      unitOfWork,
      outbox,
      () => new Date('2026-10-19T00:00:00.000Z'),
      () => 'asset-1',
    );

    const asset = await useCase.execute(
      { name: 'Node 01', assetTypeId: 'type-node' },
      actor,
    );

    expect(asset).toMatchObject({
      id: 'asset-1',
      lifecycleState: 'ACTIVE',
      assetModelId: undefined,
    });
    expect(assets.save).toHaveBeenCalledWith(asset, context);
    expect(outbox.append.mock.calls[0][0]).toMatchObject({
      producer: 'asset-topology',
      occurred_at: '2026-10-19T00:00:00.000Z',
      resource: { id: 'asset-1', sequence: 1 },
      payload: { action: 'asset_topology.asset.created', actor },
    });
  });

  it('rejects an unknown or mismatched Model before saving', async () => {
    catalog.findModel.mockResolvedValue(null);
    const useCase = new RegisterAssetUseCase(
      assets,
      catalog,
      unitOfWork,
      outbox,
    );

    await expect(
      useCase.execute(
        { name: 'Node', assetTypeId: 'type-node', modelId: 'missing' },
        actor,
      ),
    ).rejects.toThrow('Asset Model was not found');
    expect(assets.save).not.toHaveBeenCalled();
  });

  it('does not write or audit a no-op descriptive update', async () => {
    const asset = Asset.register({
      id: 'asset-1',
      name: 'Node',
      type: { id: 'type-node' },
    });
    assets.findById.mockResolvedValue(asset);
    const useCase = new UpdateAssetUseCase(assets, catalog, unitOfWork, outbox);

    await useCase.execute('asset-1', {}, actor);

    expect(assets.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('preserves identity and Type when updating and emits a material-change fact', async () => {
    const asset = Asset.register({
      id: 'asset-1',
      name: 'Node',
      type: { id: 'type-node' },
    });
    assets.findById.mockResolvedValue(asset);
    const useCase = new UpdateAssetUseCase(assets, catalog, unitOfWork, outbox);

    const updated = await useCase.execute(
      'asset-1',
      { name: 'Renamed' },
      actor,
    );

    expect(updated).toMatchObject({
      id: 'asset-1',
      assetTypeId: 'type-node',
      name: 'Renamed',
    });
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });
});
/* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

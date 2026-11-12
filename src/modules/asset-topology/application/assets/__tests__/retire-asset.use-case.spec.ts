/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Jest call records and generic UoW callback use dynamic mock signatures. */
import { Asset } from '../../../domain/asset/asset';
import { RetireAssetUseCase } from '../retire-asset.use-case';

describe('RetireAssetUseCase', () => {
  const context = {} as never;
  const actor = { type: 'user', id: 'admin-1' };
  let asset: Asset;
  let assets: {
    findById: jest.Mock;
    save: jest.Mock;
    serializeAgentEnrollmentEligibility: jest.Mock;
    list: jest.Mock;
  };
  let placements: {
    findActiveByAsset: jest.Mock;
    findActiveByRackU: jest.Mock;
    listActiveByAssetIds: jest.Mock;
    listActiveAssetIdsByRack: jest.Mock;
    listHistoryByAsset: jest.Mock;
    save: jest.Mock;
    closeActive: jest.Mock;
  };
  let bindings: { hasActiveBindingForNode: jest.Mock };
  let outbox: { append: jest.Mock };
  let unitOfWork: { run: jest.Mock };

  beforeEach(() => {
    asset = Asset.register({
      id: 'asset-1',
      name: 'Node 01',
      type: { id: 'type-node' },
    });
    assets = {
      findById: jest.fn().mockResolvedValue(asset),
      save: jest.fn().mockResolvedValue(3),
      serializeAgentEnrollmentEligibility: jest.fn().mockResolvedValue(true),
      list: jest.fn(),
    };
    placements = {
      findActiveByAsset: jest.fn().mockResolvedValue(null),
      findActiveByRackU: jest.fn(),
      listActiveByAssetIds: jest.fn(),
      listActiveAssetIdsByRack: jest.fn(),
      listHistoryByAsset: jest.fn(),
      save: jest.fn(),
      closeActive: jest.fn(),
    };
    bindings = { hasActiveBindingForNode: jest.fn().mockResolvedValue(false) };
    outbox = { append: jest.fn().mockResolvedValue(undefined) };
    unitOfWork = { run: jest.fn((callback) => callback(context)) };
  });

  it('retires an unassigned, unbound ACTIVE Asset and appends one Audit Fact', async () => {
    const useCase = new RetireAssetUseCase(
      assets,
      placements,
      bindings,
      unitOfWork,
      outbox,
      () => new Date('2026-11-08T00:00:00.000Z'),
      () => 'fact-1',
    );

    await useCase.execute('asset-1', actor);

    expect(assets.save).toHaveBeenCalledWith(
      expect.objectContaining({ lifecycleState: 'RETIRED' }),
      context,
    );
    expect(bindings.hasActiveBindingForNode).toHaveBeenCalledWith(
      'asset-1',
      context,
    );
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(outbox.append.mock.calls[0][0]).toMatchObject({
      resource: { type: 'asset-topology.asset', id: 'asset-1', sequence: 3 },
      payload: {
        actor,
        action: 'asset_topology.asset.retired',
        changes: [
          { field: 'lifecycle_state', before: 'ACTIVE', after: 'RETIRED' },
        ],
      },
    });
  });

  it('rejects a placed Asset without unmapping it', async () => {
    placements.findActiveByAsset.mockResolvedValue({ assetId: 'asset-1' });
    const useCase = new RetireAssetUseCase(
      assets,
      placements,
      bindings,
      unitOfWork,
      outbox,
    );

    await expect(useCase.execute('asset-1', actor)).rejects.toThrow(
      'Asset must be unmapped before retirement',
    );
    expect(assets.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects an Asset with an active Agent binding without revoking it', async () => {
    bindings.hasActiveBindingForNode.mockResolvedValue(true);
    const useCase = new RetireAssetUseCase(
      assets,
      placements,
      bindings,
      unitOfWork,
      outbox,
    );

    await expect(useCase.execute('asset-1', actor)).rejects.toThrow(
      'Asset has an active Agent binding',
    );
    expect(assets.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects when Agent binding status cannot be determined', async () => {
    bindings.hasActiveBindingForNode.mockRejectedValue(
      new Error('binding store unavailable'),
    );
    const useCase = new RetireAssetUseCase(
      assets,
      placements,
      bindings,
      unitOfWork,
      outbox,
    );

    await expect(useCase.execute('asset-1', actor)).rejects.toThrow(
      'binding store unavailable',
    );
    expect(assets.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('treats a repeated retirement as a no-op without another Audit Fact', async () => {
    asset = Asset.restore({
      id: asset.id,
      name: asset.name,
      assetTypeId: asset.assetTypeId,
      lifecycleState: 'RETIRED',
    });
    assets.findById.mockResolvedValue(asset);
    const useCase = new RetireAssetUseCase(
      assets,
      placements,
      bindings,
      unitOfWork,
      outbox,
    );

    await expect(useCase.execute('asset-1', actor)).resolves.toBeUndefined();
    expect(assets.save).not.toHaveBeenCalled();
    expect(bindings.hasActiveBindingForNode).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects persistence errors before appending an Audit Fact', async () => {
    assets.save.mockRejectedValue(new Error('write failed'));
    const useCase = new RetireAssetUseCase(
      assets,
      placements,
      bindings,
      unitOfWork,
      outbox,
    );

    await expect(useCase.execute('asset-1', actor)).rejects.toThrow(
      'write failed',
    );
    expect(outbox.append).not.toHaveBeenCalled();
  });
});

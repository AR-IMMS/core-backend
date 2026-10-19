/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return -- Jest mocks and generic UoW callbacks use dynamic signatures. */
import { Asset } from '../../../domain/asset/asset';
import { Rack } from '../../../domain/topology/rack';
import { AssetPlacement } from '../../../domain/placement/asset-placement';
import { AssetPlacementManagementUseCases } from '../asset-placement-management.use-case';

describe('AssetPlacementManagementUseCases', () => {
  const context = {} as never;
  const actor = { type: 'user', id: 'admin-1' };
  const currentTime = new Date('2026-10-20T01:00:00.000Z');
  let assets: { findById: jest.Mock; save: jest.Mock };
  let racks: { getRack: jest.Mock };
  let placements: {
    findActiveByAsset: jest.Mock;
    findActiveByRackU: jest.Mock;
    save: jest.Mock;
    closeActive: jest.Mock;
  };
  let unitOfWork: { run: jest.Mock };
  let outbox: { append: jest.Mock };
  let useCases: AssetPlacementManagementUseCases;

  const asset = Asset.register({
    id: 'asset-1',
    name: 'Node 01',
    type: { id: 'node' },
  });
  const rack = Rack.create({ id: 'rack-1', uCapacity: 42 });

  beforeEach(() => {
    assets = {
      findById: jest.fn().mockResolvedValue(asset),
      save: jest.fn().mockResolvedValue(1),
    };
    racks = { getRack: jest.fn().mockResolvedValue(rack) };
    placements = {
      findActiveByAsset: jest.fn().mockResolvedValue(null),
      findActiveByRackU: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      closeActive: jest.fn().mockResolvedValue(undefined),
    };
    unitOfWork = { run: jest.fn((callback) => callback(context)) };
    outbox = { append: jest.fn().mockResolvedValue(undefined) };
    useCases = new AssetPlacementManagementUseCases(
      assets as never,
      racks as never,
      placements as never,
      unitOfWork as never,
      outbox as never,
      () => currentTime,
      () => 'generated-id',
    );
  });

  it('assigns an Asset atomically and records an Audit fact', async () => {
    const result = await useCases.place('asset-1', 'rack-1', 4, actor);

    expect(result).toMatchObject({
      assetId: 'asset-1',
      rackId: 'rack-1',
      uPosition: { value: 4 },
      isActive: true,
    });
    expect(placements.save).toHaveBeenCalledWith(result, context);
    expect(assets.save).toHaveBeenCalledWith(asset, context);
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        producer: 'asset-topology',
        occurred_at: currentTime.toISOString(),
        resource: { type: 'asset-topology.asset', id: 'asset-1', sequence: 1 },
        payload: {
          actor,
          action: 'asset_topology.asset.placed',
          changes: [
            { field: 'rack_id', after: 'rack-1' },
            { field: 'u_position', after: 4 },
          ],
        },
      }),
      context,
    );
  });

  it('closes the prior location before saving a successful move in the transaction', async () => {
    const previous = AssetPlacement.start({
      id: 'placement-old',
      assetId: 'asset-1',
      rackId: 'rack-1',
      uPosition: 4,
      placedAt: new Date('2026-10-19T01:00:00.000Z'),
    });
    const destination = Rack.create({ id: 'rack-2', uCapacity: 42 });
    placements.findActiveByAsset.mockResolvedValue(previous);
    racks.getRack.mockResolvedValue(destination);

    const result = await useCases.move('asset-1', 'rack-2', 8, actor);

    expect(placements.closeActive).toHaveBeenCalledWith(
      'asset-1',
      currentTime,
      context,
    );
    expect(placements.save).toHaveBeenCalledWith(result, context);
    expect(result.rackId).toBe('rack-2');
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          actor,
          action: 'asset_topology.asset.moved',
          changes: expect.any(Array),
        },
      }),
      context,
    );
  });

  it('rejects a move into an occupied U without closing the current location', async () => {
    const previous = AssetPlacement.start({
      id: 'placement-old',
      assetId: 'asset-1',
      rackId: 'rack-1',
      uPosition: 4,
      placedAt: new Date('2026-10-19T01:00:00.000Z'),
    });
    const occupied = AssetPlacement.start({
      id: 'placement-other',
      assetId: 'asset-2',
      rackId: 'rack-2',
      uPosition: 8,
      placedAt: new Date('2026-10-19T02:00:00.000Z'),
    });
    placements.findActiveByAsset.mockResolvedValue(previous);
    placements.findActiveByRackU.mockResolvedValue(occupied);
    racks.getRack.mockResolvedValue(
      Rack.create({ id: 'rack-2', uCapacity: 42 }),
    );

    await expect(
      useCases.move('asset-1', 'rack-2', 8, actor),
    ).rejects.toThrow();
    expect(placements.closeActive).not.toHaveBeenCalled();
    expect(placements.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('treats a move to the current Rack U as a no-op without new history or Audit', async () => {
    const previous = AssetPlacement.start({
      id: 'placement-old',
      assetId: 'asset-1',
      rackId: 'rack-1',
      uPosition: 4,
      placedAt: new Date('2026-10-19T01:00:00.000Z'),
    });
    placements.findActiveByAsset.mockResolvedValue(previous);

    await expect(useCases.move('asset-1', 'rack-1', 4, actor)).resolves.toBe(
      previous,
    );
    expect(placements.closeActive).not.toHaveBeenCalled();
    expect(placements.save).not.toHaveBeenCalled();
    expect(assets.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('unmaps by closing the active location and records the change without retiring the Asset', async () => {
    const previous = AssetPlacement.start({
      id: 'placement-old',
      assetId: 'asset-1',
      rackId: 'rack-1',
      uPosition: 4,
      placedAt: new Date('2026-10-19T01:00:00.000Z'),
    });
    placements.findActiveByAsset.mockResolvedValue(previous);

    await useCases.unmap('asset-1', actor);

    expect(placements.closeActive).toHaveBeenCalledWith(
      'asset-1',
      currentTime,
      context,
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          actor,
          action: 'asset_topology.asset.unmapped',
          changes: [
            { field: 'rack_id', before: 'rack-1' },
            { field: 'u_position', before: 4 },
          ],
        },
      }),
      context,
    );
    expect(asset.lifecycleState).toBe('ACTIVE');
  });

  it('rejects a retired Asset before writing any placement or Audit data', async () => {
    assets.findById.mockResolvedValue(
      Asset.restore({
        id: 'asset-1',
        name: 'Node 01',
        assetTypeId: 'node',
        lifecycleState: 'RETIRED',
      }),
    );

    await expect(
      useCases.place('asset-1', 'rack-1', 4, actor),
    ).rejects.toThrow();
    expect(placements.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });
});

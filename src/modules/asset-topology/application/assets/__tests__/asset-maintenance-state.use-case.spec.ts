/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Jest call records and generic UoW callback use dynamic mock signatures. */
import { Asset } from '../../../domain/asset/asset';
import { ChangeAssetMaintenanceStateUseCase } from '../asset-maintenance-state.use-case';

describe('ChangeAssetMaintenanceStateUseCase', () => {
  const context = {} as never;
  const actor = { type: 'user', id: 'admin-1' };
  const request = {
    assetId: 'asset-1' as never,
    targetState: 'MAINTENANCE' as const,
    source: { type: 'manual' as const },
  };
  let assets: { findById: jest.Mock; save: jest.Mock };
  let outbox: { append: jest.Mock };
  let unitOfWork: { run: jest.Mock };

  beforeEach(() => {
    assets = {
      findById: jest.fn().mockResolvedValue(
        Asset.register({
          id: 'asset-1',
          name: 'Node 01',
          type: { id: 'type-node' },
        }),
      ),
      save: jest.fn().mockResolvedValue(2),
    };
    outbox = { append: jest.fn().mockResolvedValue(undefined) };
    unitOfWork = { run: jest.fn((callback) => callback(context)) };
  });

  it('persists and audits the state transition atomically with actor and source', async () => {
    const useCase = new ChangeAssetMaintenanceStateUseCase(
      assets as never,
      unitOfWork as never,
      outbox as never,
      () => new Date('2026-10-20T00:00:00.000Z'),
      () => 'fact-1',
    );

    await useCase.requestMaintenanceStateChange(request, actor);

    expect(assets.save.mock.calls[0][0].lifecycleState).toBe('MAINTENANCE');
    expect(assets.save).toHaveBeenCalledWith(
      assets.save.mock.calls[0][0],
      context,
    );
    expect(outbox.append.mock.calls[0][0]).toMatchObject({
      occurred_at: '2026-10-20T00:00:00.000Z',
      resource: { type: 'asset-topology.asset', id: 'asset-1', sequence: 2 },
      payload: {
        actor,
        action: 'asset_topology.asset.maintenance_state_changed.manual',
        changes: [
          { field: 'lifecycle_state', before: 'ACTIVE', after: 'MAINTENANCE' },
          { field: 'maintenance_state_change_source', after: 'manual' },
        ],
      },
    });
    expect(outbox.append.mock.calls[0][1]).toBe(context);
  });

  it('treats a repeated command as a retry-safe no-op without another Audit Fact', async () => {
    const asset = Asset.restore({
      id: 'asset-1',
      name: 'Node 01',
      assetTypeId: 'type-node',
      lifecycleState: 'MAINTENANCE',
    });
    assets.findById.mockResolvedValue(asset);
    const useCase = new ChangeAssetMaintenanceStateUseCase(
      assets as never,
      unitOfWork as never,
      outbox as never,
    );

    await useCase.requestMaintenanceStateChange(request, actor);

    expect(assets.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects a state change for an unknown Asset', async () => {
    assets.findById.mockResolvedValue(null);
    const useCase = new ChangeAssetMaintenanceStateUseCase(
      assets as never,
      unitOfWork as never,
      outbox as never,
    );

    await expect(
      useCase.requestMaintenanceStateChange(request, actor),
    ).rejects.toThrow('Asset was not found');
    expect(assets.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });
});
/* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */

import { ASSET_TOPOLOGY_CONSUMER_PORT } from '../../index';
import type {
  AssetId,
  AssetTypeId,
  AssetTopologyConsumerContract,
  AssetTopologyMaintenanceState,
  AssetTopologyQueries,
  AssetTopologyRackQueries,
  RackId,
  RoomId,
} from '../../index';

describe('Asset & Topology consumer contract', () => {
  it('exports a runtime token for application-level dependency injection', () => {
    expect(typeof ASSET_TOPOLOGY_CONSUMER_PORT).toBe('symbol');
  });

  it('represents an unassigned Asset with null current placement', async () => {
    const query: AssetTopologyQueries = {
      getAsset: () =>
        Promise.resolve({
          id: 'asset-1' as AssetId,
          name: 'Node 1',
          assetTypeId: 'node' as AssetTypeId,
          lifecycleState: 'ACTIVE',
          currentPlacement: null,
        }),
      getRack: () => Promise.resolve(null),
      getRoomMap: () => Promise.resolve(null),
      getRackLocationHistory: () => Promise.resolve(null),
      getAssetPlacementHistory: () => Promise.resolve([]),
    };

    await expect(query.getAsset('asset-1' as AssetId)).resolves.toMatchObject({
      id: 'asset-1',
      lifecycleState: 'ACTIVE',
      currentPlacement: null,
    });
  });

  it('represents a placed Asset and a Rack location without exposing domain objects', async () => {
    const query: AssetTopologyQueries = {
      getAsset: () =>
        Promise.resolve({
          id: 'asset-1' as AssetId,
          name: 'Node 1',
          assetTypeId: 'node' as AssetTypeId,
          lifecycleState: 'ACTIVE',
          currentPlacement: { rackId: 'rack-1' as RackId, uPosition: 4 },
        }),
      getRack: () =>
        Promise.resolve({
          id: 'rack-1' as RackId,
          uCapacity: 42,
          currentLocation: {
            roomId: 'room-1' as RoomId,
            column: 1,
            row: 2,
            rotation: 90,
          },
        }),
      getRoomMap: () =>
        Promise.resolve({
          id: 'room-1' as RoomId,
          status: 'ACTIVE',
          widthMm: 8000,
          depthMm: 6000,
          gridSnapMm: 100,
          columns: 80,
          rows: 60,
          layoutRevision: 0,
          walkwayCells: [],
          capacity: {
            totalCells: 4800,
            rackCapacityCells: 4800,
            activeRackCount: 0,
            freeRackCells: 4800,
          },
          racks: [],
        }),
      getRackLocationHistory: () => Promise.resolve([]),
      getAssetPlacementHistory: () => Promise.resolve([]),
    };

    await expect(query.getRack('rack-1' as RackId)).resolves.toMatchObject({
      currentLocation: {
        roomId: 'room-1',
        column: 1,
        row: 2,
        rotation: 90,
      },
    });
  });

  it('keeps the Rack query contract independently implementable', async () => {
    const rackQueries: AssetTopologyRackQueries = {
      getRack: () => Promise.resolve(null),
      getRoomMap: () => Promise.resolve(null),
      getRackLocationHistory: () => Promise.resolve([]),
    };
    await expect(
      rackQueries.getRoomMap('room-1' as RoomId),
    ).resolves.toBeNull();
  });

  it('exposes a maintenance-state request without caller supplied eligibility claims', () => {
    const request: Parameters<
      AssetTopologyConsumerContract['requestMaintenanceStateChange']
    >[0] = {
      assetId: 'asset-1' as AssetId,
      targetState: 'MAINTENANCE' satisfies AssetTopologyMaintenanceState,
      source: { type: 'manual' },
    };

    expect(request).toEqual({
      assetId: 'asset-1',
      source: { type: 'manual' },
      targetState: 'MAINTENANCE',
    });
  });
});

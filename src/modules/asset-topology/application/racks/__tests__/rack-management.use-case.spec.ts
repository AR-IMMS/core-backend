/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment -- Jest mocks are awaited and inspected by assertion helpers. */
import type { OutboxWriterPort, UnitOfWorkPort } from '@platform/events';
import { Room } from '../../../domain/topology/room';
import { RoomMap } from '../../../domain/topology/room-map';
import { Rack } from '../../../domain/topology/rack';
import { RackLocation } from '../../../domain/topology/rack-location';
import type { RackStorePort } from '../rack-store.port';
import type { TopologyStorePort } from '../../topology/topology-store.port';
import { RackManagementUseCases } from '../rack-management.use-case';

describe('RackManagementUseCases', () => {
  const actor = { type: 'user', id: 'admin-1' };
  const room = Room.create({
    id: 'room-1' as never,
    name: 'Room 1',
    siteId: 'site-1' as never,
    roomMap: RoomMap.create({
      widthMm: 5_250,
      depthMm: 4_100,
      gridSnapMm: 500,
    }),
  });
  const now = new Date('2026-10-19T00:00:00.000Z');
  let rackStore: jest.Mocked<RackStorePort>;
  let topologyStore: jest.Mocked<TopologyStorePort>;
  let outbox: jest.Mocked<OutboxWriterPort>;
  let useCases: RackManagementUseCases;

  beforeEach(() => {
    rackStore = {
      getRack: jest.fn(),
      listRacks: jest.fn(async () => []),
      listActiveLocationsInRoom: jest.fn(async () => []),
      listLocationHistory: jest.fn(async () => []),
      getActiveLocation: jest.fn(),
      saveRack: jest.fn(async () => 1),
      closeActiveLocation: jest.fn(async () => undefined),
      saveLocation: jest.fn(async () => undefined),
    };
    topologyStore = {
      getRoom: jest.fn(async () => room),
    } as unknown as jest.Mocked<TopologyStorePort>;
    const unitOfWork: UnitOfWorkPort = {
      run: (operation) => operation({} as never),
    };
    outbox = {
      append: jest.fn(async () => undefined),
    } as unknown as jest.Mocked<OutboxWriterPort>;
    useCases = new RackManagementUseCases(
      rackStore,
      topologyStore,
      unitOfWork,
      outbox,
      () => now,
      () => 'rack-1',
    );
  });

  it('creates Rack and first location and appends one Audit Fact', async () => {
    const rack = await useCases.create(
      {
        roomId: room.id,
        column: 1,
        row: 2,
        rotation: 90,
        uCapacity: 42,
        rowLabel: 'A',
        positionInRow: '03',
      },
      actor,
    );
    expect(rackStore.saveRack).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rack-1', uCapacity: 42 }),
      expect.anything(),
    );
    expect(rackStore.saveLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: room.id,
        placement: expect.objectContaining({ column: 1, row: 2 }),
      }),
      expect.anything(),
    );
    expect(rackStore.saveRack.mock.invocationCallOrder[0]).toBeLessThan(
      rackStore.saveLocation.mock.invocationCallOrder[0],
    );
    expect(rackStore.saveLocation.mock.invocationCallOrder[0]).toBeLessThan(
      outbox.append.mock.invocationCallOrder[0],
    );
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        occurred_at: now.toISOString(),
        payload: expect.objectContaining({
          actor,
          action: 'asset_topology.rack.created',
          changes: expect.arrayContaining([
            { field: 'u_capacity', after: 42 },
            { field: 'room_id', after: 'room-1' },
          ]),
        }),
      }),
      expect.anything(),
    );
    expect(rack.id).toBe('rack-1');
  });

  it('does not create location history or Audit Fact when a move is unchanged', async () => {
    const rack = Rack.create({ id: 'rack-1', uCapacity: 42 });
    const current = RackLocation.start(
      {
        rackId: rack.id,
        roomId: room.id,
        column: 1,
        row: 2,
        rotation: 90,
        locatedAt: now,
      },
      room.roomMap,
      [],
    );
    rackStore.getRack.mockResolvedValue(rack);
    rackStore.getActiveLocation.mockResolvedValue(current);

    await useCases.move(
      rack.id,
      { roomId: room.id, column: 1, row: 2, rotation: 90 },
      actor,
    );

    expect(rackStore.closeActiveLocation).not.toHaveBeenCalled();
    expect(rackStore.saveLocation).not.toHaveBeenCalled();
    expect(rackStore.saveRack).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('closes and saves location history atomically for a real move', async () => {
    const rack = Rack.create({ id: 'rack-1', uCapacity: 42 });
    const current = RackLocation.start(
      {
        rackId: rack.id,
        roomId: room.id,
        column: 1,
        row: 2,
        rotation: 0,
        locatedAt: new Date('2026-10-18T00:00:00.000Z'),
      },
      room.roomMap,
      [],
    );
    rackStore.getRack.mockResolvedValue(rack);
    rackStore.getActiveLocation.mockResolvedValue(current);

    const moved = await useCases.move(
      rack.id,
      { roomId: room.id, column: 2, row: 2, rotation: 90 },
      actor,
    );

    expect(rackStore.closeActiveLocation).toHaveBeenCalledWith(
      rack.id,
      now,
      expect.anything(),
    );
    expect(rackStore.saveLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: expect.objectContaining({ column: 2, row: 2, rotation: 90 }),
      }),
      expect.anything(),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          action: 'asset_topology.rack.location_changed',
          actor,
        }),
      }),
      expect.anything(),
    );
    expect(moved.placement).toMatchObject({ column: 2, row: 2, rotation: 90 });
  });
});

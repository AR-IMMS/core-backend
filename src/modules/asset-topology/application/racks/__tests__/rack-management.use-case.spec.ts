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
    } as unknown as jest.Mocked<RackStorePort>;
    topologyStore = {
      getRoom: jest.fn(async () => room),
      advanceRoomLayoutRevision: jest.fn(
        async (_id: string, expected: number) =>
          expected === room.layoutRevision
            ? room.update({
                name: room.name,
                roomMap: room.roomMap,
                layoutRevision: expected + 1,
              })
            : null,
      ),
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
        name: 'Core Rack',
        expectedLayoutRevision: 0,
      },
      actor,
    );
    expect(rackStore.saveRack).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'rack-1',
        name: 'Core Rack',
        uCapacity: 42,
      }),
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
            { field: 'name', after: 'Core Rack' },
            { field: 'u_capacity', after: 42 },
            { field: 'room_id', after: 'room-1' },
          ]),
        }),
      }),
      expect.anything(),
    );
    expect(rack.value.id).toBe('rack-1');
  });

  it('persists Rack name changes and attributes them in the Audit Fact', async () => {
    const rack = Rack.create({
      id: 'rack-1',
      name: 'Core Rack',
      uCapacity: 42,
    });
    rackStore.getRack.mockResolvedValue(rack);

    const updated = await useCases.update(
      rack.id,
      { name: 'Edge Rack' },
      actor,
    );

    expect(updated.name).toBe('Edge Rack');
    expect(rackStore.saveRack).toHaveBeenCalledWith(
      expect.objectContaining({ id: rack.id, name: 'Edge Rack' }),
      expect.anything(),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          action: 'asset_topology.rack.updated',
          changes: [{ field: 'name', before: 'Core Rack', after: 'Edge Rack' }],
        }),
      }),
      expect.anything(),
    );
  });

  it('rejects a Rack create on a walkway without saving or auditing', async () => {
    const roomWithWalkway = Room.create({
      id: room.id,
      name: room.name,
      siteId: room.siteId,
      roomMap: RoomMap.create({
        widthMm: 5_250,
        depthMm: 4_100,
        gridSnapMm: 500,
        walkwayCells: [{ column: 1, row: 2 }],
      }),
    });
    topologyStore.getRoom.mockResolvedValue(roomWithWalkway);
    topologyStore.advanceRoomLayoutRevision.mockResolvedValue(
      roomWithWalkway.update({
        name: room.name,
        roomMap: roomWithWalkway.roomMap,
        layoutRevision: 1,
      }),
    );

    await expect(
      useCases.create(
        {
          roomId: room.id,
          column: 1,
          row: 2,
          rotation: 0,
          name: 'Core Rack',
          uCapacity: 42,
          expectedLayoutRevision: 0,
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'RACK_CELL_RESERVED_AS_WALKWAY' });
    expect(rackStore.saveRack).not.toHaveBeenCalled();
    expect(rackStore.saveLocation).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects Rack creation in a retired Room', async () => {
    topologyStore.getRoom.mockResolvedValue(room.retire());

    await expect(
      useCases.create(
        {
          roomId: room.id,
          column: 1,
          row: 2,
          rotation: 0,
          name: 'Core Rack',
          uCapacity: 42,
          expectedLayoutRevision: 0,
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'ROOM_RETIRED' });
    expect(topologyStore.advanceRoomLayoutRevision).not.toHaveBeenCalled();
    expect(rackStore.saveRack).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rejects moving a Rack into a retired Room without closing its current location', async () => {
    const rack = Rack.create({
      id: 'rack-1',
      name: 'Core Rack',
      uCapacity: 42,
    });
    const current = RackLocation.start(
      {
        rackId: rack.id,
        roomId: 'room-source',
        column: 0,
        row: 0,
        rotation: 0,
        locatedAt: new Date('2026-10-18T00:00:00.000Z'),
      },
      room.roomMap,
      [],
    );
    rackStore.getRack.mockResolvedValue(rack);
    rackStore.getActiveLocation.mockResolvedValue(current);
    topologyStore.getRoom.mockResolvedValue(room.retire());

    await expect(
      useCases.move(
        rack.id,
        {
          roomId: room.id,
          column: 1,
          row: 2,
          rotation: 90,
          expectedLayoutRevision: 0,
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'ROOM_RETIRED' });
    expect(rackStore.closeActiveLocation).not.toHaveBeenCalled();
    expect(rackStore.saveLocation).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('does not create location history or Audit Fact when a move is unchanged', async () => {
    const rack = Rack.create({
      id: 'rack-1',
      name: 'Core Rack',
      uCapacity: 42,
    });
    const current = RackLocation.start(
      {
        rackId: rack.id,
        roomId: room.id,
        column: 1,
        row: 2,
        rotation: 90,
        locatedAt: new Date('2026-10-18T00:00:00.000Z'),
      },
      room.roomMap,
      [],
    );
    rackStore.getRack.mockResolvedValue(rack);
    rackStore.getActiveLocation.mockResolvedValue(current);

    await useCases.move(
      rack.id,
      {
        roomId: room.id,
        column: 1,
        row: 2,
        rotation: 90,
        expectedLayoutRevision: 0,
      },
      actor,
    );

    expect(rackStore.closeActiveLocation).not.toHaveBeenCalled();
    expect(rackStore.saveLocation).not.toHaveBeenCalled();
    expect(rackStore.saveRack).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('closes and saves location history atomically for a real move', async () => {
    const rack = Rack.create({
      id: 'rack-1',
      name: 'Core Rack',
      uCapacity: 42,
    });
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
      {
        roomId: room.id,
        column: 2,
        row: 2,
        rotation: 90,
        expectedLayoutRevision: 0,
      },
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
    expect(moved.value.placement).toMatchObject({
      column: 2,
      row: 2,
      rotation: 90,
    });
  });

  it('requires and advances both Room revisions for a cross-Room Rack move', async () => {
    const source = Room.create({
      id: 'room-0' as never,
      name: 'Room 0',
      siteId: room.siteId,
      roomMap: room.roomMap,
      layoutRevision: 2,
    });
    const rack = Rack.create({
      id: 'rack-1',
      name: 'Core Rack',
      uCapacity: 42,
    });
    const current = RackLocation.start(
      {
        rackId: rack.id,
        roomId: source.id,
        column: 1,
        row: 2,
        rotation: 0,
        locatedAt: new Date('2026-10-18T00:00:00.000Z'),
      },
      source.roomMap,
      [],
    );
    rackStore.getRack.mockResolvedValue(rack);
    rackStore.getActiveLocation.mockResolvedValue(current);
    topologyStore.getRoom.mockImplementation(async (id: string) =>
      id === source.id ? source : room,
    );
    topologyStore.advanceRoomLayoutRevision.mockImplementation(
      async (id: string, expected: number) => {
        const currentRoom = id === source.id ? source : room;
        return expected === currentRoom.layoutRevision
          ? currentRoom.update({
              name: currentRoom.name,
              roomMap: currentRoom.roomMap,
              layoutRevision: expected + 1,
            })
          : null;
      },
    );

    await expect(
      useCases.move(
        rack.id,
        {
          roomId: room.id,
          column: 2,
          row: 2,
          rotation: 0,
          expectedLayoutRevision: 0,
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'ROOM_LAYOUT_REVISION_REQUIRED' });
    expect(rackStore.closeActiveLocation).not.toHaveBeenCalled();

    const result = await useCases.move(
      rack.id,
      {
        roomId: room.id,
        column: 2,
        row: 2,
        rotation: 0,
        expectedLayoutRevision: 0,
        expectedSourceLayoutRevision: 2,
      },
      actor,
    );
    expect(topologyStore.advanceRoomLayoutRevision).toHaveBeenCalledWith(
      source.id,
      2,
      expect.anything(),
    );
    expect(topologyStore.advanceRoomLayoutRevision).toHaveBeenCalledWith(
      room.id,
      0,
      expect.anything(),
    );
    expect(result.layoutRevisions).toEqual([
      { roomId: source.id, revision: 3 },
      { roomId: room.id, revision: 1 },
    ]);
  });
});

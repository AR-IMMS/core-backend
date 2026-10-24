/* eslint-disable @typescript-eslint/require-await -- Promise-returning test doubles model the application ports. */
import { Room } from '../../../domain/topology/room';
import { RoomMap } from '../../../domain/topology/room-map';
import { Rack } from '../../../domain/topology/rack';
import { RackLocation } from '../../../domain/topology/rack-location';
import type { RackStorePort } from '../rack-store.port';
import type { TopologyStorePort } from '../../topology/topology-store.port';
import { RackQueryUseCase } from '../rack-query.use-case';

describe('RackQueryUseCase', () => {
  it('returns an empty Rack list for a Room with no placements', async () => {
    const room = Room.create({
      id: 'room-empty' as never,
      name: 'Empty Room',
      siteId: 'site-1' as never,
      roomMap: RoomMap.create({
        widthMm: 2_000,
        depthMm: 1_000,
        gridSnapMm: 1_000,
      }),
    });
    const getRack = jest.fn();
    const racks = {
      getRack,
      listActiveLocationsInRoom: jest.fn(async () => []),
    } as unknown as RackStorePort;
    const topology = {
      getRoom: jest.fn(async () => room),
    } as unknown as TopologyStorePort;
    const query = new RackQueryUseCase(racks, topology);

    await expect(query.getRoomMap(room.id)).resolves.toMatchObject({
      id: room.id,
      capacity: {
        totalCells: 2,
        rackCapacityCells: 2,
        activeRackCount: 0,
        freeRackCells: 2,
      },
      racks: [],
    });
    expect(getRack).not.toHaveBeenCalled();
  });

  it('returns full-cell counts and confirmed Rack references for a Room', async () => {
    const room = Room.create({
      id: 'room-1' as never,
      name: 'Room',
      siteId: 'site-1' as never,
      roomMap: RoomMap.create({
        widthMm: 5_250,
        depthMm: 4_100,
        gridSnapMm: 500,
      }),
    });
    const rack = Rack.create({
      id: 'rack-1',
      uCapacity: 42,
      name: 'Core Rack',
    });
    const location = RackLocation.start(
      {
        rackId: rack.id,
        roomId: room.id,
        column: 3,
        row: 4,
        rotation: 270,
        locatedAt: new Date(),
      },
      room.roomMap,
      [],
    );
    const store = {
      getRack: jest.fn(async () => rack),
      getActiveLocation: jest.fn(async () => location),
      listActiveLocationsInRoom: jest.fn(async () => [location]),
      listLocationHistory: jest.fn(async () => [location]),
    } as unknown as RackStorePort;
    const topology = {
      getRoom: jest.fn(async () => room),
    } as unknown as TopologyStorePort;
    const query = new RackQueryUseCase(store, topology);

    await expect(query.getRoomMap('room-1' as never)).resolves.toMatchObject({
      status: 'ACTIVE',
      columns: 10,
      rows: 8,
      racks: [
        {
          id: 'rack-1',
          name: 'Core Rack',
          currentLocation: { column: 3, row: 4, rotation: 270 },
        },
      ],
    });
  });

  it('returns ordered time-bounded location history for an existing Rack', async () => {
    const room = Room.create({
      id: 'room-1' as never,
      name: 'Room',
      siteId: 'site-1' as never,
      roomMap: RoomMap.create({
        widthMm: 5_000,
        depthMm: 4_000,
        gridSnapMm: 500,
      }),
    });
    const rack = Rack.create({
      id: 'rack-1',
      name: 'Core Rack',
      uCapacity: 42,
    });
    const location = RackLocation.start(
      {
        rackId: rack.id,
        roomId: room.id,
        column: 3,
        row: 4,
        rotation: 90,
        locatedAt: new Date('2026-10-18T00:00:00.000Z'),
      },
      room.roomMap,
      [],
    );
    const store = {
      getRack: jest.fn(async () => rack),
      listLocationHistory: jest.fn(async () => [location]),
    } as unknown as RackStorePort;
    const query = new RackQueryUseCase(store, {} as TopologyStorePort);

    await expect(
      query.getRackLocationHistory('rack-1' as never),
    ).resolves.toEqual([
      {
        roomId: 'room-1',
        column: 3,
        row: 4,
        rotation: 90,
        validFrom: '2026-10-18T00:00:00.000Z',
        validTo: null,
      },
    ]);
  });

  it('derives Rack capacity after subtracting walkway cells', async () => {
    const room = Room.create({
      id: 'room-1' as never,
      name: 'Room',
      siteId: 'site-1' as never,
      roomMap: RoomMap.create({
        widthMm: 6_000,
        depthMm: 4_000,
        gridSnapMm: 1_000,
        walkwayCells: [
          { column: 0, row: 2 },
          { column: 1, row: 2 },
          { column: 2, row: 2 },
          { column: 3, row: 2 },
          { column: 4, row: 2 },
          { column: 5, row: 2 },
        ],
      }),
    });
    const location = RackLocation.start(
      {
        rackId: 'rack-1',
        roomId: room.id,
        column: 0,
        row: 0,
        rotation: 0,
        locatedAt: new Date(),
      },
      room.roomMap,
      [],
    );
    const query = new RackQueryUseCase(
      {
        getRack: jest.fn(async () =>
          Rack.create({ id: 'rack-1', name: 'Core Rack', uCapacity: 42 }),
        ),
        listActiveLocationsInRoom: jest.fn(async () => [location]),
      } as unknown as RackStorePort,
      {
        getRoom: jest.fn(async () => room),
      } as unknown as TopologyStorePort,
    );

    await expect(query.getRoomMap(room.id)).resolves.toMatchObject({
      capacity: {
        totalCells: 24,
        rackCapacityCells: 18,
        activeRackCount: 1,
        freeRackCells: 17,
      },
    });
  });
});

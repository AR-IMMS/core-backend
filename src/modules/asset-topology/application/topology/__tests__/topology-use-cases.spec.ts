/* eslint-disable @typescript-eslint/require-await -- Jest mock implementations return resolved values directly. */
/* eslint-disable @typescript-eslint/unbound-method -- Jest matchers inspect mocked methods. */
import type {
  AuditFactV2,
  OutboxWriterPort,
  UnitOfWorkPort,
} from '@platform/events';
import { Room } from '../../../domain/topology/room';
import { RoomMap } from '../../../domain/topology/room-map';
import { Site } from '../../../domain/topology/site';
import { RackMapPlacement } from '../../../domain/topology/rack-map-placement';
import type { RackStorePort } from '../../racks/rack-store.port';
import type { TopologyStorePort } from '.././topology-store.port';
import { TopologyUseCases } from '.././topology-use-cases';

describe('TopologyUseCases', () => {
  const actor = { type: 'user', id: 'admin-1' };
  const now = new Date('2026-10-19T00:00:00.000Z');
  let sites: Site[];
  let rooms: Room[];
  let store: jest.Mocked<TopologyStorePort>;
  let outbox: jest.Mocked<OutboxWriterPort>;
  let useCases: TopologyUseCases;
  let facts: AuditFactV2[];
  let rackStore: jest.Mocked<Pick<RackStorePort, 'listActiveLocationsInRoom'>>;

  beforeEach(() => {
    sites = [];
    rooms = [];
    facts = [];
    rackStore = { listActiveLocationsInRoom: jest.fn(async () => []) };
    store = {
      getDataCenter: jest.fn(async () => ({
        id: 'dc-default' as never,
        name: 'Default Data Center',
      })),
      listSites: jest.fn(async (dataCenterId) =>
        sites.filter((site) => site.dataCenterId === dataCenterId),
      ),
      getSite: jest.fn(
        async (id) => sites.find((site) => site.id === id) ?? null,
      ),
      saveSite: jest.fn(async (site) => {
        const index = sites.findIndex((current) => current.id === site.id);
        if (index < 0) sites.push(site);
        else sites[index] = site;
        return index < 0 ? 1 : 2;
      }),
      listRooms: jest.fn(async (siteId) =>
        rooms.filter((room) => room.siteId === siteId),
      ),
      getRoom: jest.fn(
        async (id) => rooms.find((room) => room.id === id) ?? null,
      ),
      saveRoom: jest.fn(async (room) => {
        const index = rooms.findIndex((current) => current.id === room.id);
        if (index < 0) rooms.push(room);
        else rooms[index] = room;
        return index < 0 ? 1 : 2;
      }),
    };
    const unitOfWork: UnitOfWorkPort = {
      run: (operation) => operation({} as never),
    };
    outbox = {
      append: jest.fn(async (fact) => {
        facts.push(fact as AuditFactV2);
      }),
    };
    useCases = new TopologyUseCases(
      store,
      unitOfWork,
      outbox,
      () => now,
      (() => {
        let nextId = 0;
        return () => `generated-${++nextId}`;
      })(),
      rackStore as RackStorePort,
    );
  });

  it('returns only the default Data Center reference', async () => {
    await expect(useCases.getDefaultDataCenter()).resolves.toEqual({
      id: 'dc-default',
      name: 'Default Data Center',
    });
    expect(store.getDataCenter).toHaveBeenCalledWith('dc-default');
  });

  it('rejects Site creation when its Data Center parent is missing', async () => {
    store.getDataCenter.mockResolvedValue(null);

    await expect(
      useCases.createSite(
        { name: 'Building A', dataCenterId: 'missing' as never },
        actor,
      ),
    ).rejects.toThrow('Data Center was not found');
    expect(store.saveSite).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('writes Site and its Audit Fact together and preserves parent on update', async () => {
    const created = await useCases.createSite(
      { name: 'Building A', dataCenterId: 'dc-default' as never },
      actor,
    );
    const updated = await useCases.updateSite(
      created.id,
      { name: 'Building B' },
      actor,
    );

    expect(updated).toMatchObject({
      id: 'generated-1',
      name: 'Building B',
      dataCenterId: 'dc-default',
    });
    expect(store.saveSite).toHaveBeenCalledTimes(2);
    expect(facts.map((fact) => fact.payload.action)).toEqual([
      'asset_topology.site.created',
      'asset_topology.site.updated',
    ]);
    expect(facts[1]).toMatchObject({
      producer: 'asset-topology',
      occurred_at: now.toISOString(),
      resource: { type: 'asset-topology.site', id: 'generated-1', sequence: 2 },
      payload: {
        actor,
        changes: [{ field: 'name', before: 'Building A', after: 'Building B' }],
      },
    });
  });

  it('does not emit an Audit Fact for a no-op Room update', async () => {
    const site = Site.create({
      id: 'site-1' as never,
      name: 'Building A',
      dataCenterId: 'dc-default' as never,
    });
    sites.push(site);
    const roomMap = RoomMap.create({
      widthMm: 10_000,
      depthMm: 8_000,
      gridSnapMm: 100,
    });
    const room = Room.create({
      id: 'room-1' as never,
      name: 'Server Room A',
      siteId: site.id,
      roomMap,
    });
    rooms.push(room);
    store.saveRoom.mockImplementation(async (value) => {
      const index = rooms.findIndex((current) => current.id === value.id);
      rooms[index] = value;
      return 2;
    });

    const updated = await useCases.updateRoom(
      room.id,
      {
        name: 'Server Room A',
        widthMm: 10_000,
        depthMm: 8_000,
        gridSnapMm: 100,
      },
      actor,
    );

    expect(updated).toEqual(room);
    expect(store.saveRoom).not.toHaveBeenCalled();
    expect(facts).toHaveLength(0);
  });

  it('rejects grid-snap changes while the Room has an active Rack location', async () => {
    const site = Site.create({
      id: 'site-1' as never,
      name: 'Building A',
      dataCenterId: 'dc-default' as never,
    });
    const room = Room.create({
      id: 'room-1' as never,
      name: 'Room A',
      siteId: site.id,
      roomMap: RoomMap.create({
        widthMm: 10_000,
        depthMm: 8_000,
        gridSnapMm: 100,
      }),
    });
    sites.push(site);
    rooms.push(room);
    rackStore.listActiveLocationsInRoom.mockResolvedValue([
      {
        placement: RackMapPlacement.create({
          rackId: 'rack-1',
          column: 1,
          row: 2,
          rotation: 0,
        }),
      },
    ] as never);

    await expect(
      useCases.updateRoom(
        room.id,
        {
          name: room.name,
          widthMm: 10_000,
          depthMm: 8_000,
          gridSnapMm: 200,
        },
        actor,
      ),
    ).rejects.toThrow('grid snap cannot change');
    expect(store.saveRoom).not.toHaveBeenCalled();
    expect(facts).toHaveLength(0);
  });

  it('rejects Room creation when its Site parent is missing', async () => {
    await expect(
      useCases.createRoom(
        {
          name: 'Server Room A',
          siteId: 'missing' as never,
          widthMm: 10_000,
          depthMm: 8_000,
          gridSnapMm: 100,
        },
        actor,
      ),
    ).rejects.toThrow('Site was not found');
    expect(store.saveRoom).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('validates dimensions and records changed Room-map fields', async () => {
    const site = Site.create({
      id: 'site-1' as never,
      name: 'Building A',
      dataCenterId: 'dc-default' as never,
    });
    sites.push(site);
    await expect(
      useCases.createRoom(
        {
          name: 'Bad Room',
          siteId: site.id,
          widthMm: 0,
          depthMm: 1_000,
          gridSnapMm: 100,
        },
        actor,
      ),
    ).rejects.toThrow('Room width must be a positive integer');
    expect(store.saveRoom).not.toHaveBeenCalled();

    const room = await useCases.createRoom(
      {
        name: 'Server Room A',
        siteId: site.id,
        widthMm: 10_000,
        depthMm: 8_000,
        gridSnapMm: 100,
      },
      actor,
    );
    await useCases.updateRoom(
      room.id,
      {
        name: 'Server Room B',
        widthMm: 12_000,
        depthMm: 8_000,
        gridSnapMm: 100,
      },
      actor,
    );

    expect(facts[1]?.payload.changes).toEqual([
      { field: 'name', before: 'Server Room A', after: 'Server Room B' },
      { field: 'width_mm', before: 10_000, after: 12_000 },
    ]);
  });

  it('propagates an Audit Outbox append failure', async () => {
    outbox.append.mockRejectedValue(new Error('outbox unavailable'));

    await expect(
      useCases.createSite(
        { name: 'Building A', dataCenterId: 'dc-default' as never },
        actor,
      ),
    ).rejects.toThrow('outbox unavailable');
  });
});

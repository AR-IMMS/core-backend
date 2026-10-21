import { Room } from '../../domain/topology/room';
import { RoomMap } from '../../domain/topology/room-map';
import { Site } from '../../domain/topology/site';
import type {
  RackReference,
  RoomMapReference,
} from '../../contracts/asset-topology.contract';
import type { DataCenterReference } from '../../domain/topology/data-center';
import { getRoomMapDebugView } from '../room-map-debug-view';

describe('getRoomMapDebugView', () => {
  const dataCenter: DataCenterReference = {
    id: 'dc-1' as DataCenterReference['id'],
    name: 'DC-01',
  };
  const site = Site.create({
    id: 'site-1' as never,
    name: 'SITE-A',
    dataCenterId: dataCenter.id,
  });
  const room = Room.create({
    id: 'room-1' as never,
    name: 'Room B',
    siteId: site.id,
    roomMap: RoomMap.create({
      widthMm: 6_000,
      depthMm: 4_000,
      gridSnapMm: 1_000,
    }),
  });
  const rack = (
    id: string,
    name: string,
    column: number,
    row: number,
  ): RackReference => ({
    id: id as RackReference['id'],
    name,
    uCapacity: 42,
    currentLocation: {
      roomId: room.id,
      column,
      row,
      rotation: 0,
    },
  });

  const map: RoomMapReference = {
    id: room.id,
    status: 'ACTIVE',
    widthMm: 6_000,
    depthMm: 4_000,
    gridSnapMm: 1_000,
    columns: 6,
    rows: 4,
    layoutRevision: 1,
    walkwayCells: [
      { column: 2, row: 3 },
      { column: 3, row: 3 },
      { column: 0, row: 2 },
      { column: 1, row: 2 },
      { column: 2, row: 2 },
      { column: 3, row: 2 },
      { column: 4, row: 2 },
      { column: 5, row: 2 },
      { column: 2, row: 1 },
      { column: 3, row: 1 },
      { column: 2, row: 0 },
      { column: 3, row: 0 },
    ],
    capacity: {
      totalCells: 24,
      rackCapacityCells: 12,
      activeRackCount: 10,
      freeRackCells: 2,
    },
    racks: [
      rack('rack-01', 'R01', 0, 3),
      rack('rack-02', 'R02', 1, 3),
      rack('rack-03', 'R03', 4, 3),
      rack('rack-04', 'R04', 5, 3),
      rack('rack-05', 'R05', 0, 1),
      rack('rack-06', 'R06', 1, 1),
      rack('rack-07', 'R07', 4, 1),
      rack('rack-08', 'R08', 5, 1),
      rack('rack-09', 'R09', 0, 0),
      rack('rack-10', 'R10', 5, 0),
    ],
  };

  function queries(roomMap: RoomMapReference | null = map) {
    return {
      getRoomMap: jest.fn(() => Promise.resolve(roomMap)),
      getRoom: jest.fn(() => Promise.resolve(room)),
      getSite: jest.fn(() => Promise.resolve(site)),
      getDefaultDataCenter: jest.fn(() => Promise.resolve(dataCenter)),
    };
  }

  it('renders the map layers, derived labels, and occupancy statistics', async () => {
    await expect(getRoomMapDebugView(room.id, queries())).resolves.toBe(
      [
        'Data Center: DC-01',
        'Site       : SITE-A',
        'Room       : Room B (6 x 4)',
        '',
        '          1 |       2 | 3 | 4 |       5 |       6',
        '    --------+---------+---+---+---------+--------',
        ' D  R01@D-1 | R02@D-2 | # | # | R03@D-5 | R04@D-6',
        ' C  #       | #       | # | # | #       | #',
        ' B  R05@B-1 | R06@B-2 | # | # | R07@B-5 | R08@B-6',
        ' A  R09@A-1 | .       | # | # | .       | R10@A-6',
        '',
        'Statistics',
        '- Grid size   : 6 x 4',
        '- Total cells : 24',
        '- Racks       : 10',
        '- Walkways    : 12',
        '- Empty cells : 2',
        '',
        'Legend: # = walkway, . = empty cell',
      ].join('\n'),
    );
  });

  it('reports a clear error when the Room does not exist', async () => {
    await expect(getRoomMapDebugView(room.id, queries(null))).rejects.toThrow(
      'Room "room-1" does not exist.',
    );
  });

  it('rejects map data when a Rack overlaps a walkway', async () => {
    const invalid = {
      ...map,
      racks: [rack('rack-01', 'R01', 2, 3)],
      capacity: {
        totalCells: 24,
        rackCapacityCells: 12,
        activeRackCount: 1,
        freeRackCells: 11,
      },
    };

    await expect(
      getRoomMapDebugView(room.id, queries(invalid)),
    ).rejects.toThrow(
      'Invalid Room map: Rack "R01" occupies walkway cell 2,3.',
    );
  });
});

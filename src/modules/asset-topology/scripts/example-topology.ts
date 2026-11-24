import { DEFAULT_DATA_CENTER_ID } from '../domain/topology/data-center';
import { Rack } from '../domain/topology/rack';
import { RackLocation } from '../domain/topology/rack-location';
import type { RackRotation } from '../domain/topology/rack-map-placement';
import { Room } from '../domain/topology/room';
import { RoomMap } from '../domain/topology/room-map';
import type { RoomMapCell } from '../domain/topology/room-map-cell';
import type { RoomId } from '../domain/topology/room';
import { Site } from '../domain/topology/site';
import type { SiteId } from '../domain/topology/site';

export interface ExampleRack {
  readonly rack: Rack;
  readonly location: RackLocation;
}

const cell = (column: number, row: number): RoomMapCell => ({ column, row });

function walkways(
  columns: number,
  rows: number,
  vertical: number,
): RoomMapCell[] {
  const cells: RoomMapCell[] = [];
  for (let column = 0; column < columns; column++) cells.push(cell(column, 0));
  for (let row = 1; row < rows; row++) cells.push(cell(vertical, row));
  return cells;
}

/** Optional development example, separate from the default Data Center migration. */
export function buildExampleTopology(locatedAt: Date): {
  sites: readonly Site[];
  rooms: readonly Room[];
  racks: readonly ExampleRack[];
} {
  const sites = [
    Site.create({
      id: 'example-site-north' as SiteId,
      name: 'North Building',
      dataCenterId: DEFAULT_DATA_CENTER_ID,
    }),
    Site.create({
      id: 'example-site-south' as SiteId,
      name: 'South Building',
      dataCenterId: DEFAULT_DATA_CENTER_ID,
    }),
  ];
  const rooms = [
    Room.create({
      id: 'example-room-main' as RoomId,
      name: 'Main Server Hall',
      siteId: sites[0].id,
      roomMap: RoomMap.create({
        widthMm: 8000,
        depthMm: 6000,
        gridSnapMm: 1000,
        walkwayCells: walkways(8, 6, 3),
      }),
    }),
    Room.create({
      id: 'example-room-network' as RoomId,
      name: 'Network Room',
      siteId: sites[0].id,
      roomMap: RoomMap.create({
        widthMm: 6000,
        depthMm: 5000,
        gridSnapMm: 1000,
        walkwayCells: walkways(6, 5, 2),
      }),
    }),
    Room.create({
      id: 'example-room-secondary' as RoomId,
      name: 'Secondary Hall',
      siteId: sites[1].id,
      roomMap: RoomMap.create({
        widthMm: 7000,
        depthMm: 5000,
        gridSnapMm: 1000,
        walkwayCells: walkways(7, 5, 3),
      }),
    }),
  ];
  const racks: ExampleRack[] = [];
  const positions: readonly (readonly [
    number,
    number,
    number,
    RackRotation,
    number,
  ])[] = [
    [0, 1, 4, 0, 42],
    [0, 2, 4, 90, 42],
    [0, 5, 4, 180, 48],
    [0, 6, 4, 270, 48],
    [0, 1, 2, 0, 42],
    [0, 2, 2, 90, 42],
    [0, 5, 2, 180, 48],
    [0, 6, 2, 270, 48],
    [1, 1, 3, 0, 24],
    [1, 3, 3, 90, 42],
    [1, 1, 1, 180, 24],
    [1, 3, 1, 270, 42],
    [2, 1, 3, 0, 42],
    [2, 2, 3, 90, 42],
    [2, 4, 3, 180, 48],
    [2, 1, 1, 270, 42],
    [2, 4, 1, 0, 48],
    [2, 5, 1, 90, 48],
  ];
  for (const [roomIndex, column, row, rotation, uCapacity] of positions) {
    const room = rooms[roomIndex];
    const rowLetter = String.fromCharCode(65 + row);
    const position = String(column + 1).padStart(2, '0');
    const name = `R-${rowLetter}-${position}`;
    const rack = Rack.create({
      id: `example-${room.id}-${name}`,
      name,
      uCapacity,
    });
    const location = RackLocation.start(
      { rackId: rack.id, roomId: room.id, column, row, rotation, locatedAt },
      room.roomMap,
      racks
        .filter((item) => item.location.roomId === room.id)
        .map((item) => item.location.placement),
    );
    racks.push({ rack, location });
  }
  return { sites, rooms, racks };
}

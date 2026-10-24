import type { RoomId } from '../domain/topology/room';
import type { Room } from '../domain/topology/room';
import type { Site } from '../domain/topology/site';
import type { DataCenterReference } from '../domain/topology/data-center';
import type {
  RackReference,
  RoomMapReference,
} from '../contracts/asset-topology.contract';

export interface RoomMapDebugViewQueries {
  getRoomMap(roomId: RoomId): Promise<RoomMapReference | null>;
  getRoom(roomId: RoomId): Promise<Room>;
  getSite(siteId: Site['id']): Promise<Site>;
  getDefaultDataCenter(): Promise<DataCenterReference>;
}

/** Loads the canonical Room-map query and renders its current placement data. */
export async function getRoomMapDebugView(
  roomId: RoomId,
  queries: RoomMapDebugViewQueries,
): Promise<string> {
  const map = await queries.getRoomMap(roomId);
  if (!map) throw new Error(`Room "${roomId}" does not exist.`);

  const room = await queries.getRoom(roomId);
  const site = await queries.getSite(room.siteId);
  const dataCenter = await queries.getDefaultDataCenter();

  if (map.id !== room.id) {
    throw new Error(
      `Invalid Room map: returned Room ID "${map.id}" does not match "${room.id}".`,
    );
  }
  if (site.id !== room.siteId || site.dataCenterId !== dataCenter.id) {
    throw new Error('Invalid Room map: Room parent hierarchy is inconsistent.');
  }

  return renderRoomMapDebugView({ dataCenter, site, room, map });
}

function renderRoomMapDebugView(input: {
  readonly dataCenter: DataCenterReference;
  readonly site: Site;
  readonly room: Room;
  readonly map: RoomMapReference;
}): string {
  const { dataCenter, site, room, map } = input;
  if (
    !Number.isSafeInteger(map.columns) ||
    map.columns < 1 ||
    !Number.isSafeInteger(map.rows) ||
    map.rows < 1 ||
    !Number.isSafeInteger(map.widthMm) ||
    map.widthMm < 1 ||
    !Number.isSafeInteger(map.depthMm) ||
    map.depthMm < 1 ||
    !Number.isSafeInteger(map.gridSnapMm) ||
    map.gridSnapMm < 1 ||
    map.columns !== Math.floor(map.widthMm / map.gridSnapMm) ||
    map.rows !== Math.floor(map.depthMm / map.gridSnapMm)
  ) {
    throw new Error('Invalid Room map: grid dimensions are inconsistent.');
  }

  const totalCells = map.columns * map.rows;
  if (!Number.isSafeInteger(totalCells)) {
    throw new Error('Invalid Room map: grid size is not a safe integer.');
  }
  if (
    !isReadonlyArrayOf<RoomMapReference['walkwayCells'][number]>(
      map.walkwayCells,
    ) ||
    !isReadonlyArrayOf<RackReference>(map.racks) ||
    !map.capacity ||
    typeof map.capacity !== 'object'
  ) {
    throw new Error('Invalid Room map: cells or capacity data is missing.');
  }

  const walkways = new Set<string>();
  for (const cell of map.walkwayCells) {
    if (!cell || typeof cell !== 'object') {
      throw new Error('Invalid Room map: a walkway cell is malformed.');
    }
    validateCell(cell.column, cell.row, map, 'Walkway');
    const key = cellKey(cell.column, cell.row);
    if (walkways.has(key)) {
      throw new Error(
        `Invalid Room map: duplicate walkway cell ${cell.column},${cell.row}.`,
      );
    }
    walkways.add(key);
  }

  const racksByCell = new Map<string, RackReference>();
  const rackIds = new Set<string>();
  for (const rack of map.racks) {
    if (!rack || typeof rack !== 'object' || typeof rack.name !== 'string') {
      throw new Error('Invalid Room map: a Rack entry is malformed.');
    }
    if (!rack.name.trim()) {
      throw new Error('Invalid Room map: a Rack has no display name.');
    }
    if (!rack.currentLocation) {
      throw new Error(
        `Invalid Room map: Rack "${rack.name}" has no current placement.`,
      );
    }
    const { roomId, column, row } = rack.currentLocation;
    if (roomId !== room.id) {
      throw new Error(
        `Invalid Room map: Rack "${rack.name}" belongs to another Room.`,
      );
    }
    validateCell(column, row, map, `Rack "${rack.name}"`);
    const key = cellKey(column, row);
    if (walkways.has(key)) {
      throw new Error(
        `Invalid Room map: Rack "${rack.name}" occupies walkway cell ${column},${row}.`,
      );
    }
    if (racksByCell.has(key)) {
      throw new Error(
        `Invalid Room map: multiple Racks occupy cell ${column},${row}.`,
      );
    }
    if (rackIds.has(rack.id)) {
      throw new Error(`Invalid Room map: duplicate Rack ID "${rack.id}".`);
    }
    racksByCell.set(key, rack);
    rackIds.add(rack.id);
  }

  const emptyCells = totalCells - walkways.size - racksByCell.size;
  if (emptyCells < 0) {
    throw new Error('Invalid Room map: occupied cells exceed the grid size.');
  }
  if (
    map.capacity.totalCells !== totalCells ||
    map.capacity.rackCapacityCells !== totalCells - walkways.size ||
    map.capacity.activeRackCount !== racksByCell.size ||
    map.capacity.freeRackCells !== emptyCells
  ) {
    throw new Error(
      'Invalid Room map: capacity summary does not match the grid contents.',
    );
  }

  const rowLabels = Array.from({ length: map.rows }, (_, index) =>
    rowLabel(map.rows - index - 1),
  );
  const rowLabelWidth = Math.max(2, ...rowLabels.map((label) => label.length));
  const cellsByRow = rowLabels.map((_, index) => {
    const row = map.rows - index - 1;
    return Array.from({ length: map.columns }, (_, column) => {
      const key = cellKey(column, row);
      const rack = racksByCell.get(key);
      if (rack) return `${rack.name}@${rowLabel(row)}-${column + 1}`;
      return walkways.has(key) ? '#' : '.';
    });
  });
  const columnWidths = Array.from({ length: map.columns }, (_, column) =>
    Math.max(
      String(column + 1).length,
      ...cellsByRow.map((cells) => cells[column].length),
    ),
  );
  const rowPrefixWidth = rowLabelWidth + 2;
  const header = `${' '.repeat(rowPrefixWidth)}${columnWidths
    .map((width, index) => String(index + 1).padStart(width))
    .join(' | ')}`;
  const divider = `${' '.repeat(rowPrefixWidth)}${columnWidths
    .map((width) => '-'.repeat(width))
    .join('-+-')}`;
  const rows = cellsByRow.map((cells, index) =>
    `${rowLabels[index].padStart(rowLabelWidth)}  ${cells
      .map((cell, column) => cell.padEnd(columnWidths[column]))
      .join(' | ')} `.trimEnd(),
  );

  return [
    `Data Center: ${dataCenter.name}`,
    `Site       : ${site.name}`,
    `Room       : ${room.name} (${map.columns} x ${map.rows})`,
    '',
    header,
    divider,
    ...rows,
    '',
    'Statistics',
    `- Grid size   : ${map.columns} x ${map.rows}`,
    `- Total cells : ${totalCells}`,
    `- Racks       : ${racksByCell.size}`,
    `- Walkways    : ${walkways.size}`,
    `- Empty cells : ${emptyCells}`,
    '',
    'Legend: # = walkway, . = empty cell',
  ].join('\n');
}

function validateCell(
  column: number,
  row: number,
  map: RoomMapReference,
  label: string,
): void {
  if (
    !Number.isSafeInteger(column) ||
    !Number.isSafeInteger(row) ||
    column < 0 ||
    row < 0 ||
    column >= map.columns ||
    row >= map.rows
  ) {
    throw new Error(
      `Invalid Room map: ${label} cell ${column},${row} is outside the grid.`,
    );
  }
}

function cellKey(column: number, row: number): string {
  return `${column},${row}`;
}

function isReadonlyArrayOf<T>(value: unknown): value is readonly T[] {
  return Array.isArray(value);
}

function rowLabel(row: number): string {
  let value = row + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

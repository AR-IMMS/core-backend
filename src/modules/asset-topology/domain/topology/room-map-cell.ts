/** Integer coordinate for one complete cell in a generated Room grid. */
export interface RoomMapCell {
  readonly column: number;
  readonly row: number;
}

/** Stable ordering for Room-map cells: bottom-to-top, then left-to-right. */
export function compareRoomMapCells(
  left: RoomMapCell,
  right: RoomMapCell,
): number {
  return left.row - right.row || left.column - right.column;
}

/** Coordinate key shared by Room-map cell-set comparisons. */
export function roomMapCellKey(cell: RoomMapCell): string {
  return `${cell.column}:${cell.row}`;
}

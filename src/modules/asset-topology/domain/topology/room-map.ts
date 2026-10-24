import { DomainError } from '../shared/domain-error';
import { compareRoomMapCells, roomMapCellKey } from './room-map-cell';
import type { RoomMapCell } from './room-map-cell';

/**
 * List of error codes defined within the RoomMap domain.
 * Used to ensure consistency and prevent magic strings across the codebase.
 */
export const RoomMapErrorCode = {
  INVALID_MAP: 'INVALID_ROOM_MAP',
  CELL_OUT_OF_BOUNDS: 'CELL_OUT_OF_BOUNDS',
  DUPLICATE_WALKWAY_CELL: 'DUPLICATE_WALKWAY_CELL',
} as const;

/**
 * Properties required to create a new room map.
 */
export interface CreateRoomMapProps {
  readonly widthMm: number;
  readonly depthMm: number;
  readonly gridSnapMm: number;
  readonly walkwayCells?: readonly RoomMapCell[];
}

/**
 * Helper function to validate that a given value is a positive integer.
 *
 * @param value The number to validate
 * @param field The name of the field being validated (used for error messages)
 * @throws {DomainError} If the value is not a positive integer
 */
function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DomainError(
      RoomMapErrorCode.INVALID_MAP,
      `${field} must be a positive integer`,
    );
  }
}

/**
 * Represents the RoomMap Domain Entity.
 * Defines the physical dimensions and grid snap settings of a room.
 */
export class RoomMap {
  private constructor(
    public readonly widthMm: number,
    public readonly depthMm: number,
    public readonly gridSnapMm: number,
    public readonly walkwayCells: readonly RoomMapCell[],
  ) {}

  get columns(): number {
    return Math.floor(this.widthMm / this.gridSnapMm);
  }

  get rows(): number {
    return Math.floor(this.depthMm / this.gridSnapMm);
  }

  /**
   * Creates a new RoomMap instance based on the provided properties.
   * Validates that width, depth, and grid snap are positive integers.
   *
   * @param props The properties required to create the room map
   * @returns A new instance of RoomMap
   * @throws {DomainError} If any dimension or grid snap value is invalid
   */
  static create(props: CreateRoomMapProps): RoomMap {
    requirePositiveInteger(props.widthMm, 'Room width');
    requirePositiveInteger(props.depthMm, 'Room depth');
    requirePositiveInteger(props.gridSnapMm, 'Grid snap');

    const columns = Math.floor(props.widthMm / props.gridSnapMm);
    const rows = Math.floor(props.depthMm / props.gridSnapMm);
    const walkwayCells = [...(props.walkwayCells ?? [])].sort(
      compareRoomMapCells,
    );
    const seen = new Set<string>();
    for (const cell of walkwayCells) {
      if (
        !Number.isInteger(cell.column) ||
        !Number.isInteger(cell.row) ||
        cell.column < 0 ||
        cell.row < 0 ||
        cell.column >= columns ||
        cell.row >= rows
      ) {
        throw new DomainError(
          RoomMapErrorCode.CELL_OUT_OF_BOUNDS,
          'Walkway cell must be inside the Room grid',
        );
      }
      const key = roomMapCellKey(cell);
      if (seen.has(key)) {
        throw new DomainError(
          RoomMapErrorCode.DUPLICATE_WALKWAY_CELL,
          'Walkway cells must not contain duplicates',
        );
      }
      seen.add(key);
    }

    return new RoomMap(
      props.widthMm,
      props.depthMm,
      props.gridSnapMm,
      walkwayCells.map(({ column, row }) => ({ column, row })),
    );
  }
}

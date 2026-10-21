import { DomainError } from '../shared/domain-error';
import { RackMapPlacement } from './rack-map-placement';
import { RoomMap } from './room-map';

/**
 * List of error codes defined within the RackLayoutPolicy domain.
 * Used to ensure consistency and prevent magic strings across the codebase.
 */
export const RackLayoutPolicyErrorCode = {
  OUTSIDE_ROOM: 'RACK_OUTSIDE_ROOM',
  OVERLAP: 'RACK_OVERLAP',
  WALKWAY: 'RACK_CELL_RESERVED_AS_WALKWAY',
} as const;

/**
 * Represents the RackLayoutPolicy Domain Service / Policy.
 * Validates one-cell Rack placements against Room grid bounds and occupancy.
 */
export class RackLayoutPolicy {
  /**
   * Validates whether a candidate cell exists and is unoccupied.
   *
   * @param room The room map defining dimensions and grid constraints
   * @param candidate The candidate rack placement to validate
   * @param otherRacksInRoom A list of existing racks already placed in the room
   * @throws {DomainError} If the cell is outside the Room grid or occupied.
   */
  static validate(
    room: RoomMap,
    candidate: RackMapPlacement,
    otherRacksInRoom: readonly RackMapPlacement[],
  ): void {
    if (candidate.column >= room.columns || candidate.row >= room.rows) {
      throw new DomainError(
        RackLayoutPolicyErrorCode.OUTSIDE_ROOM,
        'Rack cell must be inside the Room grid',
      );
    }

    if (
      room.walkwayCells.some(
        (cell) =>
          cell.column === candidate.column && cell.row === candidate.row,
      )
    ) {
      throw new DomainError(
        RackLayoutPolicyErrorCode.WALKWAY,
        'Rack cell is reserved as a walkway',
      );
    }

    const overlaps = otherRacksInRoom.some((otherRack) => {
      if (otherRack.rackId === candidate.rackId) {
        return false;
      }

      return (
        candidate.column === otherRack.column && candidate.row === otherRack.row
      );
    });

    if (overlaps) {
      throw new DomainError(
        RackLayoutPolicyErrorCode.OVERLAP,
        'Rack cell is already occupied',
      );
    }
  }
}

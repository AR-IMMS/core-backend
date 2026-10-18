import { DomainError } from '../shared/domain-error';
import { RackMapPlacement } from './rack-map-placement';
import { RoomMap } from './room-map';

/**
 * List of error codes defined within the RackLayoutPolicy domain.
 * Used to ensure consistency and prevent magic strings across the codebase.
 */
export const RackLayoutPolicyErrorCode = {
  POSITION_OFF_GRID: 'RACK_POSITION_OFF_GRID',
  OUTSIDE_ROOM: 'RACK_OUTSIDE_ROOM',
  OVERLAP: 'RACK_OVERLAP',
} as const;

/**
 * Represents the RackLayoutPolicy Domain Service / Policy.
 * Encapsulates validation rules regarding rack placements within a room map (grid alignment, boundaries, and overlap checking).
 */
export class RackLayoutPolicy {
  /**
   * Validates whether a candidate rack placement complies with room constraints and doesn't overlap with other racks.
   *
   * @param room The room map defining dimensions and grid constraints
   * @param candidate The candidate rack placement to validate
   * @param otherRacksInRoom A list of existing racks already placed in the room
   * @throws {DomainError} If the rack is off-grid, outside the room boundaries, or overlaps with another rack
   */
  static validate(
    room: RoomMap,
    candidate: RackMapPlacement,
    otherRacksInRoom: readonly RackMapPlacement[],
  ): void {
    if (
      candidate.xMm % room.gridSnapMm !== 0 ||
      candidate.yMm % room.gridSnapMm !== 0
    ) {
      throw new DomainError(
        RackLayoutPolicyErrorCode.POSITION_OFF_GRID,
        'Rack position must align with the Room grid',
      );
    }

    const candidateRight = candidate.xMm + candidate.effectiveWidthMm;
    const candidateTop = candidate.yMm + candidate.effectiveDepthMm;

    if (candidateRight > room.widthMm || candidateTop > room.depthMm) {
      throw new DomainError(
        RackLayoutPolicyErrorCode.OUTSIDE_ROOM,
        'Rack footprint must fit inside the Room',
      );
    }

    const overlaps = otherRacksInRoom.some((otherRack) => {
      if (otherRack.rackId === candidate.rackId) {
        return false;
      }

      const otherRight = otherRack.xMm + otherRack.effectiveWidthMm;
      const otherTop = otherRack.yMm + otherRack.effectiveDepthMm;

      return (
        candidate.xMm < otherRight &&
        candidateRight > otherRack.xMm &&
        candidate.yMm < otherTop &&
        candidateTop > otherRack.yMm
      );
    });

    if (overlaps) {
      throw new DomainError(
        RackLayoutPolicyErrorCode.OVERLAP,
        'Rack footprints must not overlap',
      );
    }
  }
}

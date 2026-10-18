import { RackLayoutPolicy } from './rack-layout-policy';
import { RackMapPlacement } from './rack-map-placement';
import { RoomMap } from './room-map';

/**
 * Validates a proposed Room map against the Rack placements that must remain
 * valid under the new dimensions and grid configuration.
 */
export class RoomMapChangePolicy {
  /**
   * @throws {DomainError} If a Rack is outside the proposed Room, off-grid, or
   * overlaps another Rack.
   */
  static validate(
    proposedRoomMap: RoomMap,
    currentRackPlacements: readonly RackMapPlacement[],
  ): void {
    for (const placement of currentRackPlacements) {
      RackLayoutPolicy.validate(
        proposedRoomMap,
        placement,
        currentRackPlacements,
      );
    }
  }
}

import { RackLayoutPolicy } from './rack-layout-policy';
import { RackMapPlacement } from './rack-map-placement';
import { RoomMap } from './room-map';
import { DomainError } from '../shared/domain-error';

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
    currentRoomMap: RoomMap,
    proposedRoomMap: RoomMap,
    currentRackPlacements: readonly RackMapPlacement[],
  ): void {
    if (
      proposedRoomMap.gridSnapMm !== currentRoomMap.gridSnapMm &&
      currentRackPlacements.length > 0
    ) {
      throw new DomainError(
        'ROOM_GRID_SNAP_IN_USE',
        'Room grid snap cannot change while Racks are placed',
      );
    }
    for (const placement of currentRackPlacements) {
      RackLayoutPolicy.validate(
        proposedRoomMap,
        placement,
        currentRackPlacements,
      );
    }
  }
}

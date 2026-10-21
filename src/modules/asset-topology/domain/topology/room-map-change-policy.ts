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
      (currentRackPlacements.length > 0 ||
        currentRoomMap.walkwayCells.length > 0)
    ) {
      throw new DomainError(
        'GRID_SNAP_CHANGE_NOT_ALLOWED',
        'Room grid snap cannot change while Racks are placed',
      );
    }
    for (const placement of currentRackPlacements) {
      if (
        placement.column >= proposedRoomMap.columns ||
        placement.row >= proposedRoomMap.rows
      ) {
        throw new DomainError(
          'ROOM_GRID_CHANGE_INVALIDATES_LAYOUT',
          'Room dimensions cannot exclude an existing Rack location',
        );
      }
      RackLayoutPolicy.validate(
        proposedRoomMap,
        placement,
        currentRackPlacements,
      );
    }
    for (const cell of currentRoomMap.walkwayCells) {
      if (
        cell.column >= proposedRoomMap.columns ||
        cell.row >= proposedRoomMap.rows
      ) {
        throw new DomainError(
          'ROOM_GRID_CHANGE_INVALIDATES_LAYOUT',
          'Room dimensions cannot exclude an existing walkway cell',
        );
      }
    }
  }
}

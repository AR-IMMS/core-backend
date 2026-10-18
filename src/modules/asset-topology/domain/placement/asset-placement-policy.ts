import { DomainError } from '../shared/domain-error';
import { Rack } from '../topology/rack';
import { AssetPlacement, StartAssetPlacementProps } from './asset-placement';

/** Stable error codes for Asset placement lifecycle rules. */
export const AssetPlacementPolicyErrorCode = {
  ASSET_ALREADY_PLACED: 'ASSET_ALREADY_PLACED',
  RACK_NOT_FOUND: 'PLACEMENT_RACK_NOT_FOUND',
  U_POSITION_OCCUPIED: 'RACK_U_POSITION_OCCUPIED',
  ACTIVE_PLACEMENT_REQUIRED: 'ACTIVE_PLACEMENT_REQUIRED',
  ACTIVE_PLACEMENT_MISMATCH: 'ACTIVE_PLACEMENT_MISMATCH',
  DESTINATION_ASSET_MISMATCH: 'PLACEMENT_DESTINATION_ASSET_MISMATCH',
} as const;

export interface MoveAssetPlacementResult {
  readonly closedPlacement: AssetPlacement;
  readonly activePlacement: AssetPlacement;
}

/** Coordinates Asset placement operations against supplied domain state. */
export class AssetPlacementPolicy {
  /** Places an unassigned Asset into a valid, unoccupied Rack U. */
  static place(
    props: StartAssetPlacementProps,
    activePlacements: readonly AssetPlacement[],
    racks: readonly Rack[],
  ): AssetPlacement {
    const active = activePlacements.filter((placement) => placement.isActive);
    if (
      active.some((placement) => placement.assetId === props.assetId.trim())
    ) {
      throw new DomainError(
        AssetPlacementPolicyErrorCode.ASSET_ALREADY_PLACED,
        'Asset already has an active placement',
      );
    }

    const candidate = AssetPlacement.start(props);
    this.validateDestination(candidate, active, racks);
    return candidate;
  }

  /** Closes the current placement and returns the new active placement. */
  static move(
    currentPlacement: AssetPlacement,
    destination: StartAssetPlacementProps,
    activePlacements: readonly AssetPlacement[],
    racks: readonly Rack[],
  ): MoveAssetPlacementResult {
    const active = activePlacements.filter((placement) => placement.isActive);
    this.requireCurrentPlacement(currentPlacement, active);

    if (destination.assetId.trim() !== currentPlacement.assetId) {
      throw new DomainError(
        AssetPlacementPolicyErrorCode.DESTINATION_ASSET_MISMATCH,
        'Destination placement must reference the same Asset',
      );
    }

    const candidate = AssetPlacement.start(destination);
    this.validateDestination(
      candidate,
      active.filter((placement) => placement.id !== currentPlacement.id),
      racks,
    );

    return {
      closedPlacement: currentPlacement.close(candidate.validFrom),
      activePlacement: candidate,
    };
  }

  /** Closes the current placement while retaining its history. */
  static unmap(
    currentPlacement: AssetPlacement,
    activePlacements: readonly AssetPlacement[],
    endedAt: Date,
  ): AssetPlacement {
    const active = activePlacements.filter((placement) => placement.isActive);
    this.requireCurrentPlacement(currentPlacement, active);
    return currentPlacement.close(endedAt);
  }

  private static requireCurrentPlacement(
    currentPlacement: AssetPlacement,
    activePlacements: readonly AssetPlacement[],
  ): void {
    const placementsForAsset = activePlacements.filter(
      (placement) => placement.assetId === currentPlacement.assetId,
    );

    if (
      !currentPlacement.isActive ||
      placementsForAsset.length !== 1 ||
      placementsForAsset[0].id !== currentPlacement.id
    ) {
      throw new DomainError(
        AssetPlacementPolicyErrorCode.ACTIVE_PLACEMENT_REQUIRED,
        'The Asset must have exactly one matching active placement',
      );
    }
  }

  private static validateDestination(
    candidate: AssetPlacement,
    activePlacements: readonly AssetPlacement[],
    racks: readonly Rack[],
  ): void {
    const rack = racks.find((item) => item.id === candidate.rackId);
    if (!rack) {
      throw new DomainError(
        AssetPlacementPolicyErrorCode.RACK_NOT_FOUND,
        `Rack ${candidate.rackId} was not supplied`,
      );
    }
    rack.validateUPosition(candidate.uPosition);

    if (
      activePlacements.some(
        (placement) =>
          placement.rackId === candidate.rackId &&
          placement.uPosition.value === candidate.uPosition.value,
      )
    ) {
      throw new DomainError(
        AssetPlacementPolicyErrorCode.U_POSITION_OCCUPIED,
        'Rack U position already has an active Asset',
      );
    }
  }
}

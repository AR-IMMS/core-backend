import { DomainError } from '../shared/domain-error';
import { RackUnitPosition } from './rack-unit-position';

/**
 * List of error codes defined within the AssetPlacement domain.
 * Used to ensure consistency and prevent magic strings across the codebase.
 */
export const AssetPlacementErrorCode = {
  IDENTITY_REQUIRED: 'PLACEMENT_IDENTITY_REQUIRED',
  INVALID_TIME: 'INVALID_PLACEMENT_TIME',
  ALREADY_CLOSED: 'PLACEMENT_ALREADY_CLOSED',
  INVALID_END_TIME: 'INVALID_PLACEMENT_END_TIME',
} as const;

/**
 * Properties required to start a new asset placement.
 */
export interface StartAssetPlacementProps {
  readonly id: string;
  readonly assetId: string;
  readonly rackId: string;
  readonly uPosition: number;
  readonly placedAt: Date;
}

/**
 * Represents the AssetPlacement Domain Entity.
 * Manages the lifecycle of an asset being placed onto a rack unit position.
 */
export class AssetPlacement {
  private constructor(
    public readonly id: string,
    public readonly assetId: string,
    public readonly rackId: string,
    public readonly uPosition: RackUnitPosition,
    private readonly startTime: Date,
    private readonly endTime: Date | undefined,
  ) {}

  /**
   * Starts a new asset placement based on the provided properties.
   * Validates identities and placement timestamps before creating the instance.
   *
   * @param props The properties required to start the asset placement
   * @returns A new instance of AssetPlacement
   * @throws {DomainError} If placement, asset, or rack IDs are missing, or if the start time is invalid
   */
  static start(props: StartAssetPlacementProps): AssetPlacement {
    const id = props.id.trim();
    const assetId = props.assetId.trim();
    const rackId = props.rackId.trim();

    if (!id || !assetId || !rackId) {
      throw new DomainError(
        AssetPlacementErrorCode.IDENTITY_REQUIRED,
        'Placement, Asset, and Rack IDs are required',
      );
    }

    if (Number.isNaN(props.placedAt.getTime())) {
      throw new DomainError(
        AssetPlacementErrorCode.INVALID_TIME,
        'Placement start time is invalid',
      );
    }

    return new AssetPlacement(
      id,
      assetId,
      rackId,
      RackUnitPosition.from(props.uPosition),
      new Date(props.placedAt),
      undefined,
    );
  }

  /**
   * Gets the start time of the placement (immutable copy).
   */
  get validFrom(): Date {
    return new Date(this.startTime);
  }

  /**
   * Gets the end time of the placement if it has been closed, otherwise undefined (immutable copy).
   */
  get validTo(): Date | undefined {
    return this.endTime ? new Date(this.endTime) : undefined;
  }

  /**
   * Checks whether the asset placement is currently active.
   */
  get isActive(): boolean {
    return this.endTime === undefined;
  }

  /**
   * Closes the current active placement.
   *
   * @param endedAt The timestamp when the placement ends
   * @returns A new AssetPlacement instance with the updated end time (Immutability)
   * @throws {DomainError} If the placement is already closed or if the end time is invalid/not after the start time
   */
  close(endedAt: Date): AssetPlacement {
    if (!this.isActive) {
      throw new DomainError(
        AssetPlacementErrorCode.ALREADY_CLOSED,
        'Placement is already closed',
      );
    }

    if (
      Number.isNaN(endedAt.getTime()) ||
      endedAt.getTime() <= this.startTime.getTime()
    ) {
      throw new DomainError(
        AssetPlacementErrorCode.INVALID_END_TIME,
        'Placement end time must be after start time',
      );
    }

    return new AssetPlacement(
      this.id,
      this.assetId,
      this.rackId,
      this.uPosition,
      this.startTime,
      new Date(endedAt),
    );
  }
}

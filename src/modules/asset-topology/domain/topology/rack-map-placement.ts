import { DomainError } from '../shared/domain-error';

/**
 * List of error codes defined within the RackMapPlacement domain.
 * Used to ensure consistency and prevent magic strings across the codebase.
 */
export const RackMapPlacementErrorCode = {
  RACK_ID_REQUIRED: 'RACK_ID_REQUIRED',
  INVALID_POSITION: 'INVALID_RACK_POSITION',
  INVALID_FOOTPRINT: 'INVALID_RACK_FOOTPRINT',
  INVALID_ROTATION: 'INVALID_RACK_ROTATION',
} as const;

/**
 * Valid rotation angles for a rack in degrees.
 */
export type RackRotation = 0 | 90 | 180 | 270;

/**
 * Properties required to create a new rack map placement.
 */
export interface CreateRackMapPlacementProps {
  readonly rackId: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly rotation: RackRotation;
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
      RackMapPlacementErrorCode.INVALID_FOOTPRINT,
      `${field} must be a positive integer`,
    );
  }
}

/**
 * Represents the RackMapPlacement Domain Entity.
 * Manages the physical positioning, dimensions, and orientation of a rack on a room map.
 */
export class RackMapPlacement {
  private constructor(
    public readonly rackId: string,
    public readonly xMm: number,
    public readonly yMm: number,
    public readonly widthMm: number,
    public readonly depthMm: number,
    public readonly rotation: RackRotation,
  ) {}

  /**
   * Creates a new RackMapPlacement instance based on the provided properties.
   * Validates rack ID, coordinates (must be non-negative integers), and dimensions (must be positive integers).
   *
   * @param props The properties required to create the rack placement
   * @returns A new instance of RackMapPlacement
   * @throws {DomainError} If the rack ID is missing, coordinates are invalid, or dimensions are invalid
   */
  static create(props: CreateRackMapPlacementProps): RackMapPlacement {
    const rackId = props.rackId.trim();

    if (!rackId) {
      throw new DomainError(
        RackMapPlacementErrorCode.RACK_ID_REQUIRED,
        'Rack ID is required',
      );
    }

    if (
      !Number.isInteger(props.xMm) ||
      !Number.isInteger(props.yMm) ||
      props.xMm < 0 ||
      props.yMm < 0
    ) {
      throw new DomainError(
        RackMapPlacementErrorCode.INVALID_POSITION,
        'Rack coordinates must be non-negative integers',
      );
    }

    requirePositiveInteger(props.widthMm, 'Rack width');
    requirePositiveInteger(props.depthMm, 'Rack depth');

    if (![0, 90, 180, 270].includes(props.rotation)) {
      throw new DomainError(
        RackMapPlacementErrorCode.INVALID_ROTATION,
        'Rack rotation must be 0, 90, 180, or 270 degrees',
      );
    }

    return new RackMapPlacement(
      rackId,
      props.xMm,
      props.yMm,
      props.widthMm,
      props.depthMm,
      props.rotation,
    );
  }

  /**
   * Calculates the effective width of the rack considering its rotation.
   * Swaps width and depth when rotated by 90 or 270 degrees.
   */
  get effectiveWidthMm(): number {
    return this.rotation === 90 || this.rotation === 270
      ? this.depthMm
      : this.widthMm;
  }

  /**
   * Calculates the effective depth of the rack considering its rotation.
   * Swaps width and depth when rotated by 90 or 270 degrees.
   */
  get effectiveDepthMm(): number {
    return this.rotation === 90 || this.rotation === 270
      ? this.widthMm
      : this.depthMm;
  }
}

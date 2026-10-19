import { DomainError } from '../shared/domain-error';

/**
 * List of error codes defined within the RackMapPlacement domain.
 * Used to ensure consistency and prevent magic strings across the codebase.
 */
export const RackMapPlacementErrorCode = {
  RACK_ID_REQUIRED: 'RACK_ID_REQUIRED',
  INVALID_POSITION: 'INVALID_RACK_POSITION',
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
  readonly column: number;
  readonly row: number;
  readonly rotation: RackRotation;
}

/**
 * Represents the RackMapPlacement Domain Entity.
 * Stores a Rack's one-cell grid coordinate and orientation on a Room map.
 */
export class RackMapPlacement {
  private constructor(
    public readonly rackId: string,
    public readonly column: number,
    public readonly row: number,
    public readonly rotation: RackRotation,
  ) {}

  /**
   * Creates a new RackMapPlacement instance based on the provided properties.
   * Validates Rack ID, non-negative integer cell coordinates, and cardinal rotation.
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
      !Number.isInteger(props.column) ||
      !Number.isInteger(props.row) ||
      props.column < 0 ||
      props.row < 0
    ) {
      throw new DomainError(
        RackMapPlacementErrorCode.INVALID_POSITION,
        'Rack cell coordinates must be non-negative integers',
      );
    }

    if (![0, 90, 180, 270].includes(props.rotation)) {
      throw new DomainError(
        RackMapPlacementErrorCode.INVALID_ROTATION,
        'Rack rotation must be 0, 90, 180, or 270 degrees',
      );
    }

    return new RackMapPlacement(
      rackId,
      props.column,
      props.row,
      props.rotation,
    );
  }
}

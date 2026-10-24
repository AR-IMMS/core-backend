import { DomainError } from '../shared/domain-error';

/**
 * List of error codes defined within the RackUnitPosition value object.
 * Used to ensure consistency and prevent magic strings across the codebase.
 */
export const RackUnitPositionErrorCode = {
  INVALID_POSITION: 'INVALID_RACK_UNIT_POSITION',
} as const;

/**
 * Represents the RackUnitPosition Value Object.
 * Ensures that the rack U position follows domain rules (must be a positive integer).
 */
export class RackUnitPosition {
  private constructor(public readonly value: number) {}

  /**
   * Creates a new RackUnitPosition instance from a raw number.
   * Validates that the value is an integer greater than or equal to 1.
   *
   * @param value The raw number representing the rack unit position
   * @returns A new instance of RackUnitPosition
   * @throws {DomainError} If the value is not a positive integer
   */
  static from(value: number): RackUnitPosition {
    if (!Number.isInteger(value) || value < 1) {
      throw new DomainError(
        RackUnitPositionErrorCode.INVALID_POSITION,
        'Rack U position must be a positive integer',
      );
    }

    return new RackUnitPosition(value);
  }
}

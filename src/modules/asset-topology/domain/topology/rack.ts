import { DomainError } from '../shared/domain-error';
import { RackUnitPosition } from '../placement/rack-unit-position';

/** Stable error codes for Rack identity and capacity rules. */
export const RackErrorCode = {
  ID_REQUIRED: 'RACK_ID_REQUIRED',
  INVALID_CAPACITY: 'INVALID_RACK_CAPACITY',
  POSITION_EXCEEDS_CAPACITY: 'RACK_U_POSITION_EXCEEDS_CAPACITY',
} as const;

export interface CreateRackProps {
  readonly id: string;
  readonly uCapacity: number;
}

/** Rack identity and declared U capacity. */
export class Rack {
  private constructor(
    public readonly id: string,
    public readonly uCapacity: number,
  ) {}

  static create(props: CreateRackProps): Rack {
    const id = props.id.trim();
    if (!id) {
      throw new DomainError(RackErrorCode.ID_REQUIRED, 'Rack ID is required');
    }

    if (!Number.isInteger(props.uCapacity) || props.uCapacity <= 0) {
      throw new DomainError(
        RackErrorCode.INVALID_CAPACITY,
        'Rack U capacity must be a positive integer',
      );
    }

    return new Rack(id, props.uCapacity);
  }

  /** @throws {DomainError} If the position is above this Rack's capacity. */
  validateUPosition(position: RackUnitPosition): void {
    if (position.value > this.uCapacity) {
      throw new DomainError(
        RackErrorCode.POSITION_EXCEEDS_CAPACITY,
        `Rack U position must not exceed capacity ${this.uCapacity}`,
      );
    }
  }
}

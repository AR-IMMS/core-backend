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
  readonly rowLabel?: string;
  readonly positionInRow?: string;
}

export interface UpdateRackProps {
  readonly uCapacity?: number;
  readonly rowLabel?: string | null;
  readonly positionInRow?: string | null;
}

/** Rack identity and declared U capacity. */
export class Rack {
  private constructor(
    public readonly id: string,
    public readonly uCapacity: number,
    public readonly rowLabel: string | undefined,
    public readonly positionInRow: string | undefined,
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

    return new Rack(
      id,
      props.uCapacity,
      normalizeLabel(props.rowLabel, 'Rack row label'),
      normalizeLabel(props.positionInRow, 'Rack position label'),
    );
  }

  update(props: UpdateRackProps): Rack {
    return Rack.create({
      id: this.id,
      uCapacity: props.uCapacity ?? this.uCapacity,
      rowLabel:
        props.rowLabel === undefined
          ? this.rowLabel
          : (props.rowLabel ?? undefined),
      positionInRow:
        props.positionInRow === undefined
          ? this.positionInRow
          : (props.positionInRow ?? undefined),
    });
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

function normalizeLabel(value: string | undefined, field: string) {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) {
    throw new DomainError('INVALID_RACK_LABEL', `${field} cannot be empty`);
  }
  return normalized;
}

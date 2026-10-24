import { DomainError } from '../shared/domain-error';
import { RackLayoutPolicy } from './rack-layout-policy';
import { RackMapPlacement, RackRotation } from './rack-map-placement';
import { RoomMap } from './room-map';

/** Stable error codes for Rack location history rules. */
export const RackLocationErrorCode = {
  IDENTITY_REQUIRED: 'RACK_LOCATION_IDENTITY_REQUIRED',
  INVALID_TIME: 'INVALID_RACK_LOCATION_TIME',
  ALREADY_CLOSED: 'RACK_LOCATION_ALREADY_CLOSED',
  RACK_MISMATCH: 'RACK_LOCATION_RACK_MISMATCH',
} as const;

export interface StartRackLocationProps {
  readonly rackId: string;
  readonly roomId: string;
  readonly column: number;
  readonly row: number;
  readonly rotation: RackRotation;
  readonly locatedAt: Date;
}

export interface RelocateRackResult {
  readonly closedLocation: RackLocation;
  readonly activeLocation: RackLocation;
}

/** Time-bounded physical location and Room-map placement for a Rack. */
export class RackLocation {
  private constructor(
    public readonly rackId: string,
    public readonly roomId: string,
    public readonly placement: RackMapPlacement,
    private readonly startTime: Date,
    private readonly endTime: Date | undefined,
  ) {}

  static start(
    props: StartRackLocationProps,
    roomMap: RoomMap,
    otherRacksInRoom: readonly RackMapPlacement[],
  ): RackLocation {
    const rackId = props.rackId.trim();
    const roomId = props.roomId.trim();
    if (!rackId || !roomId) {
      throw new DomainError(
        RackLocationErrorCode.IDENTITY_REQUIRED,
        'Rack ID and Room ID are required',
      );
    }

    if (Number.isNaN(props.locatedAt.getTime())) {
      throw new DomainError(
        RackLocationErrorCode.INVALID_TIME,
        'Rack location start time is invalid',
      );
    }

    const placement = RackMapPlacement.create({
      rackId,
      column: props.column,
      row: props.row,
      rotation: props.rotation,
    });
    RackLayoutPolicy.validate(roomMap, placement, otherRacksInRoom);

    return new RackLocation(
      rackId,
      roomId,
      placement,
      new Date(props.locatedAt),
      undefined,
    );
  }

  static fromHistory(props: {
    readonly rackId: string;
    readonly roomId: string;
    readonly column: number;
    readonly row: number;
    readonly rotation: RackRotation;
    readonly validFrom: Date;
    readonly validTo?: Date;
  }): RackLocation {
    const rackId = props.rackId.trim();
    const roomId = props.roomId.trim();
    if (!rackId || !roomId || Number.isNaN(props.validFrom.getTime())) {
      throw new DomainError(
        RackLocationErrorCode.IDENTITY_REQUIRED,
        'Rack location history is invalid',
      );
    }
    if (
      props.validTo &&
      (Number.isNaN(props.validTo.getTime()) ||
        props.validTo <= props.validFrom)
    ) {
      throw new DomainError(
        RackLocationErrorCode.INVALID_TIME,
        'Rack location interval is invalid',
      );
    }
    const placement = RackMapPlacement.create({
      rackId,
      column: props.column,
      row: props.row,
      rotation: props.rotation,
    });
    return new RackLocation(
      rackId,
      roomId,
      placement,
      new Date(props.validFrom),
      props.validTo ? new Date(props.validTo) : undefined,
    );
  }

  get validFrom(): Date {
    return new Date(this.startTime);
  }

  get validTo(): Date | undefined {
    return this.endTime ? new Date(this.endTime) : undefined;
  }

  get isActive(): boolean {
    return this.endTime === undefined;
  }

  relocate(
    destination: StartRackLocationProps,
    destinationRoomMap: RoomMap,
    otherRacksInRoom: readonly RackMapPlacement[],
  ): RelocateRackResult {
    if (!this.isActive) {
      throw new DomainError(
        RackLocationErrorCode.ALREADY_CLOSED,
        'Rack location is already closed',
      );
    }

    if (destination.rackId.trim() !== this.rackId) {
      throw new DomainError(
        RackLocationErrorCode.RACK_MISMATCH,
        'Destination location must reference the same Rack',
      );
    }

    if (
      Number.isNaN(destination.locatedAt.getTime()) ||
      destination.locatedAt.getTime() <= this.startTime.getTime()
    ) {
      throw new DomainError(
        RackLocationErrorCode.INVALID_TIME,
        'Rack location end time must be valid and after its start time',
      );
    }

    const activeLocation = RackLocation.start(
      destination,
      destinationRoomMap,
      otherRacksInRoom,
    );

    return {
      closedLocation: new RackLocation(
        this.rackId,
        this.roomId,
        this.placement,
        this.startTime,
        new Date(destination.locatedAt),
      ),
      activeLocation,
    };
  }
}

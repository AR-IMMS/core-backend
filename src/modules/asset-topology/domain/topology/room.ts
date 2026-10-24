import { DomainError } from '../shared/domain-error';
import type { RoomMap } from './room-map';
import type { SiteId } from './site';

/** Canonical identity for a Room in Asset & Topology. */
export type RoomId = string & { readonly __assetTopologyId: 'RoomId' };
export type RoomStatus = 'ACTIVE' | 'RETIRED';

/** Values required to register a Room under a Site. */
export interface CreateRoomProps {
  readonly id: RoomId;
  readonly name: string;
  readonly siteId: SiteId;
  readonly roomMap: RoomMap;
  readonly layoutRevision?: number;
  readonly status?: RoomStatus;
}

/** A named physical room with a rectangular map, grid, and terminal retirement status. */
export class Room {
  private constructor(
    public readonly id: RoomId,
    public readonly name: string,
    public readonly siteId: SiteId,
    public readonly roomMap: RoomMap,
    public readonly layoutRevision: number,
    public readonly status: RoomStatus,
  ) {}

  /** Creates a Room under its immutable Site reference. */
  static create(props: CreateRoomProps): Room {
    const id = props.id.trim();
    const name = props.name.trim();
    const siteId = props.siteId.trim();
    if (!id) throw new DomainError('ROOM_ID_REQUIRED', 'Room ID is required');
    if (!name)
      throw new DomainError('ROOM_NAME_REQUIRED', 'Room name is required');
    if (!siteId)
      throw new DomainError('ROOM_SITE_REQUIRED', 'Room Site is required');

    const layoutRevision = props.layoutRevision ?? 0;
    if (!Number.isInteger(layoutRevision) || layoutRevision < 0) {
      throw new DomainError(
        'INVALID_ROOM_LAYOUT_REVISION',
        'Room layout revision must be a non-negative integer',
      );
    }
    return new Room(
      id as RoomId,
      name,
      siteId as SiteId,
      props.roomMap,
      layoutRevision,
      props.status ?? 'ACTIVE',
    );
  }

  /** Returns an updated Room while retaining its identity and Site reference. */
  update(props: {
    readonly name: string;
    readonly roomMap: RoomMap;
    readonly layoutRevision?: number;
  }): Room {
    const name = props.name.trim();
    if (!name)
      throw new DomainError('ROOM_NAME_REQUIRED', 'Room name is required');

    return new Room(
      this.id,
      name,
      this.siteId,
      props.roomMap,
      props.layoutRevision ?? this.layoutRevision,
      this.status,
    );
  }

  /** Retires the Room while retaining its topology and historical identity. */
  retire(): Room {
    if (this.status === 'RETIRED') return this;
    return new Room(
      this.id,
      this.name,
      this.siteId,
      this.roomMap,
      this.layoutRevision,
      'RETIRED',
    );
  }
}

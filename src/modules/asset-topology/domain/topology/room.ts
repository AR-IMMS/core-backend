import { DomainError } from '../shared/domain-error';
import type { RoomMap } from './room-map';
import type { SiteId } from './site';

/** Canonical identity for a Room in Asset & Topology. */
export type RoomId = string & { readonly __assetTopologyId: 'RoomId' };

/** Values required to register a Room under a Site. */
export interface CreateRoomProps {
  readonly id: RoomId;
  readonly name: string;
  readonly siteId: SiteId;
  readonly roomMap: RoomMap;
}

/** A named physical room with a rectangular map and grid configuration. */
export class Room {
  private constructor(
    public readonly id: RoomId,
    public readonly name: string,
    public readonly siteId: SiteId,
    public readonly roomMap: RoomMap,
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

    return new Room(id as RoomId, name, siteId as SiteId, props.roomMap);
  }

  /** Returns an updated Room while retaining its identity and Site reference. */
  update(props: { readonly name: string; readonly roomMap: RoomMap }): Room {
    const name = props.name.trim();
    if (!name)
      throw new DomainError('ROOM_NAME_REQUIRED', 'Room name is required');

    return new Room(this.id, name, this.siteId, props.roomMap);
  }
}

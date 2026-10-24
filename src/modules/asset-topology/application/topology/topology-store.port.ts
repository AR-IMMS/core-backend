import type { UnitOfWorkContext } from '@platform/events';
import type { DataCenterReference } from '../../domain/topology/data-center';
import type { Room } from '../../domain/topology/room';
import type { Site } from '../../domain/topology/site';

/** Persistence boundary for Asset & Topology-owned location records. */
export interface TopologyStorePort {
  getDataCenter(id: string): Promise<DataCenterReference | null>;
  listSites(dataCenterId: string): Promise<readonly Site[]>;
  getSite(id: string): Promise<Site | null>;
  /** Saves the Site and increments its Audit sequence in the active transaction. */
  saveSite(site: Site, context: UnitOfWorkContext): Promise<number>;
  /** Lists active Rooms; retired Rooms remain available through getRoom for history. */
  listRooms(siteId: string): Promise<readonly Room[]>;
  /** Retrieves active or retired Rooms so historical references remain resolvable. */
  getRoom(id: string, context?: UnitOfWorkContext): Promise<Room | null>;
  /**
   * Atomically advances a Room layout revision when the expected value matches.
   * Returns null if the Room is missing or has already changed.
   */
  advanceRoomLayoutRevision(
    id: string,
    expectedRevision: number,
    context: UnitOfWorkContext,
  ): Promise<Room | null>;
  /** Saves the Room and increments its Audit sequence in the active transaction. */
  saveRoom(room: Room, context: UnitOfWorkContext): Promise<number>;
  /** Atomically retires a Room if its layout revision is still current. */
  retireRoom(
    id: string,
    expectedRevision: number,
    context: UnitOfWorkContext,
  ): Promise<number | null>;
}

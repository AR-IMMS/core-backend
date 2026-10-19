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
  listRooms(siteId: string): Promise<readonly Room[]>;
  getRoom(id: string): Promise<Room | null>;
  /** Saves the Room and increments its Audit sequence in the active transaction. */
  saveRoom(room: Room, context: UnitOfWorkContext): Promise<number>;
}

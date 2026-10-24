import type { UnitOfWorkContext } from '@platform/events';
import type { Rack } from '../../domain/topology/rack';
import type { RackLocation } from '../../domain/topology/rack-location';

/** Persistence boundary for Rack identity and time-bounded Room locations. */
export interface RackStorePort {
  getRack(id: string, context?: UnitOfWorkContext): Promise<Rack | null>;
  listRacks(): Promise<readonly Rack[]>;
  listActiveLocationsInRoom(
    roomId: string,
    context?: UnitOfWorkContext,
  ): Promise<readonly RackLocation[]>;
  listLocationHistory(rackId: string): Promise<readonly RackLocation[]>;
  getActiveLocation(
    rackId: string,
    context?: UnitOfWorkContext,
  ): Promise<RackLocation | null>;
  saveRack(rack: Rack, context: UnitOfWorkContext): Promise<number>;
  closeActiveLocation(
    rackId: string,
    validTo: Date,
    context: UnitOfWorkContext,
  ): Promise<void>;
  saveLocation(
    location: RackLocation,
    context: UnitOfWorkContext,
  ): Promise<void>;
}

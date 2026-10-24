import { Inject, Injectable } from '@nestjs/common';
import type {
  AssetTopologyRackQueries,
  RackLocationHistoryEntry,
  RackId,
  RackReference,
  RoomId,
  RoomMapReference,
} from '../../contracts/asset-topology.contract';
import { Rack } from '../../domain/topology/rack';
import type { RackLocation } from '../../domain/topology/rack-location';
import type { TopologyStorePort } from '../topology/topology-store.port';
import { TOPOLOGY_STORE } from '../topology/topology-store.token';
import type { RackStorePort } from './rack-store.port';
import { RACK_STORE } from './rack-store.token';

/** Read-only Rack and Room-map consumer contract implementation. */
@Injectable()
export class RackQueryUseCase implements AssetTopologyRackQueries {
  constructor(
    @Inject(RACK_STORE) private readonly racks: RackStorePort,
    @Inject(TOPOLOGY_STORE) private readonly topology: TopologyStorePort,
  ) {}

  async getRack(rackId: RackId): Promise<RackReference | null> {
    const rack = await this.racks.getRack(rackId);
    if (!rack) return null;
    return this.toReference(rack, await this.racks.getActiveLocation(rack.id));
  }

  async getRoomMap(roomId: RoomId): Promise<RoomMapReference | null> {
    const room = await this.topology.getRoom(roomId);
    if (!room) return null;
    const locations = await this.racks.listActiveLocationsInRoom(room.id);
    const racks = await Promise.all(
      locations.map(async (location) => {
        const rack = await this.racks.getRack(location.rackId);
        return rack ? this.toReference(rack, location) : null;
      }),
    );
    return {
      id: room.id,
      status: room.status,
      widthMm: room.roomMap.widthMm,
      depthMm: room.roomMap.depthMm,
      gridSnapMm: room.roomMap.gridSnapMm,
      columns: room.roomMap.columns,
      rows: room.roomMap.rows,
      layoutRevision: room.layoutRevision,
      walkwayCells: room.roomMap.walkwayCells,
      capacity: {
        totalCells: room.roomMap.columns * room.roomMap.rows,
        rackCapacityCells:
          room.roomMap.columns * room.roomMap.rows -
          room.roomMap.walkwayCells.length,
        activeRackCount: locations.length,
        freeRackCells:
          room.roomMap.columns * room.roomMap.rows -
          room.roomMap.walkwayCells.length -
          locations.length,
      },
      racks: racks.filter((rack): rack is RackReference => rack !== null),
    };
  }

  async getRackLocationHistory(
    rackId: RackId,
  ): Promise<readonly RackLocationHistoryEntry[] | null> {
    if (!(await this.racks.getRack(rackId))) return null;
    const locations = await this.racks.listLocationHistory(rackId);
    return locations.map((location) => ({
      roomId: location.roomId as RoomId,
      column: location.placement.column,
      row: location.placement.row,
      rotation: location.placement.rotation,
      validFrom: location.validFrom.toISOString(),
      validTo: location.validTo?.toISOString() ?? null,
    }));
  }

  private toReference(
    rack: Rack,
    location: RackLocation | null,
  ): RackReference {
    return {
      id: rack.id as RackId,
      name: rack.name,
      uCapacity: rack.uCapacity,
      currentLocation: location
        ? {
            roomId: location.roomId as RoomId,
            column: location.placement.column,
            row: location.placement.row,
            rotation: location.placement.rotation,
          }
        : null,
    };
  }
}

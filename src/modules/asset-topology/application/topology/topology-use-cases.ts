import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION_V2,
  OUTBOX_WRITER_PORT,
  UNIT_OF_WORK_PORT,
  type AuditFactV2,
  type OutboxWriterPort,
  type UnitOfWorkPort,
} from '@platform/events';
import { Room } from '../../domain/topology/room';
import { RoomMap } from '../../domain/topology/room-map';
import type { RoomId } from '../../domain/topology/room';
import { DEFAULT_DATA_CENTER_ID } from '../../domain/topology/data-center';
import type { DataCenterId } from '../../domain/topology/data-center';
import { Site } from '../../domain/topology/site';
import type { SiteId } from '../../domain/topology/site';
import type { TopologyStorePort } from './topology-store.port';
import { TOPOLOGY_STORE } from './topology-store.token';
import { RoomMapChangePolicy } from '../../domain/topology/room-map-change-policy';
import type { RoomMapCell } from '../../domain/topology/room-map-cell';
import type { RackStorePort } from '../racks/rack-store.port';
import { RACK_STORE } from '../racks/rack-store.token';
import { DomainError } from '../../domain/shared/domain-error';

export interface TopologyActor {
  readonly type: string;
  readonly id: string;
  readonly context?: TopologyRequestContext;
}

export interface TopologyRequestContext {
  readonly request_id?: string;
  readonly trace_id?: string;
}

export class TopologyResourceNotFoundError extends Error {
  constructor(resource: 'Data Center' | 'Site' | 'Room') {
    super(`${resource} was not found`);
    this.name = 'TopologyResourceNotFoundError';
  }
}

export class RoomLayoutRevisionConflictError extends Error {
  constructor() {
    super('Room layout has changed. Reload the Room map and retry.');
    this.name = 'RoomLayoutRevisionConflictError';
  }
}

export class RoomHasActiveRacksError extends DomainError {
  constructor() {
    super(
      'ROOM_HAS_ACTIVE_RACKS',
      'Room cannot be retired while Racks are placed in it',
    );
    this.name = 'RoomHasActiveRacksError';
  }
}

export interface CreateSiteInput {
  readonly name: string;
  readonly dataCenterId: DataCenterId;
}

export interface UpdateSiteInput {
  readonly name: string;
}

export interface CreateRoomInput {
  readonly name: string;
  readonly siteId: SiteId;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly gridSnapMm: number;
}

export interface UpdateRoomInput {
  readonly name?: string;
  readonly widthMm?: number;
  readonly depthMm?: number;
  readonly gridSnapMm?: number;
  readonly walkwayCells?: readonly RoomMapCell[];
  readonly expectedLayoutRevision?: number;
}

/** Application use cases for the Flow 1 Data Center → Site → Room hierarchy. */
@Injectable()
export class TopologyUseCases {
  constructor(
    @Inject(TOPOLOGY_STORE)
    private readonly store: TopologyStorePort,
    @Inject(UNIT_OF_WORK_PORT)
    private readonly unitOfWork: UnitOfWorkPort,
    @Inject(OUTBOX_WRITER_PORT)
    private readonly outbox: OutboxWriterPort,
    @Optional() private readonly now: () => Date = () => new Date(),
    @Optional() private readonly generateId: () => string = randomUUID,
    @Optional() @Inject(RACK_STORE) private readonly racks?: RackStorePort,
  ) {}

  async getDefaultDataCenter() {
    const dataCenter = await this.store.getDataCenter(DEFAULT_DATA_CENTER_ID);
    if (!dataCenter) throw new TopologyResourceNotFoundError('Data Center');
    return dataCenter;
  }

  async listSites(dataCenterId: DataCenterId): Promise<readonly Site[]> {
    const dataCenter = await this.store.getDataCenter(dataCenterId);
    if (!dataCenter) throw new TopologyResourceNotFoundError('Data Center');
    return this.store.listSites(dataCenterId);
  }

  async createSite(
    input: CreateSiteInput,
    actor: TopologyActor,
  ): Promise<Site> {
    return this.unitOfWork.run(async (context) => {
      const dataCenter = await this.store.getDataCenter(input.dataCenterId);
      if (!dataCenter) throw new TopologyResourceNotFoundError('Data Center');
      const site = Site.create({
        id: this.generateId() as SiteId,
        name: input.name,
        dataCenterId: dataCenter.id,
      });
      const sequence = await this.store.saveSite(site, context);
      await this.outbox.append(
        this.createAuditFact({
          actor,
          action: 'asset_topology.site.created',
          resourceType: 'asset-topology.site',
          resourceId: site.id,
          sequence,
          changes: [
            { field: 'name', after: site.name },
            { field: 'data_center_id', after: site.dataCenterId },
          ],
        }),
        context,
      );
      return site;
    });
  }

  async getSite(siteId: SiteId): Promise<Site> {
    const site = await this.store.getSite(siteId);
    if (!site) throw new TopologyResourceNotFoundError('Site');
    return site;
  }

  async updateSite(
    siteId: SiteId,
    input: UpdateSiteInput,
    actor: TopologyActor,
  ): Promise<Site> {
    return this.unitOfWork.run(async (context) => {
      const current = await this.store.getSite(siteId);
      if (!current) throw new TopologyResourceNotFoundError('Site');
      const updated = current.rename(input.name);
      if (updated.name === current.name) return current;

      const sequence = await this.store.saveSite(updated, context);
      await this.outbox.append(
        this.createAuditFact({
          actor,
          action: 'asset_topology.site.updated',
          resourceType: 'asset-topology.site',
          resourceId: updated.id,
          sequence,
          changes: [
            { field: 'name', before: current.name, after: updated.name },
          ],
        }),
        context,
      );
      return updated;
    });
  }

  async listRooms(siteId: SiteId): Promise<readonly Room[]> {
    const site = await this.store.getSite(siteId);
    if (!site) throw new TopologyResourceNotFoundError('Site');
    return this.store.listRooms(siteId);
  }

  async createRoom(
    input: CreateRoomInput,
    actor: TopologyActor,
  ): Promise<Room> {
    return this.unitOfWork.run(async (context) => {
      const site = await this.store.getSite(input.siteId);
      if (!site) throw new TopologyResourceNotFoundError('Site');
      const room = Room.create({
        id: this.generateId() as RoomId,
        name: input.name,
        siteId: site.id,
        roomMap: RoomMap.create(input),
      });
      const sequence = await this.store.saveRoom(room, context);
      await this.outbox.append(
        this.createAuditFact({
          actor,
          action: 'asset_topology.room.created',
          resourceType: 'asset-topology.room',
          resourceId: room.id,
          sequence,
          changes: [
            { field: 'name', after: room.name },
            { field: 'site_id', after: room.siteId },
            { field: 'width_mm', after: room.roomMap.widthMm },
            { field: 'depth_mm', after: room.roomMap.depthMm },
            { field: 'grid_snap_mm', after: room.roomMap.gridSnapMm },
          ],
        }),
        context,
      );
      return room;
    });
  }

  async getRoom(roomId: RoomId): Promise<Room> {
    const room = await this.store.getRoom(roomId);
    if (!room) throw new TopologyResourceNotFoundError('Room');
    return room;
  }

  async retireRoom(roomId: RoomId, actor: TopologyActor): Promise<Room> {
    return this.unitOfWork.run(async (context) => {
      const current = await this.store.getRoom(roomId, context);
      if (!current) throw new TopologyResourceNotFoundError('Room');
      if (current.status === 'RETIRED') return current;

      const activeLocations =
        await this.requireRackStore().listActiveLocationsInRoom(
          roomId,
          context,
        );
      if (activeLocations.length > 0) throw new RoomHasActiveRacksError();

      const sequence = await this.store.retireRoom(
        roomId,
        current.layoutRevision,
        context,
      );
      if (sequence === null) throw new RoomLayoutRevisionConflictError();

      const retired = current.retire();
      await this.outbox.append(
        this.createAuditFact({
          actor,
          action: 'asset_topology.room.retired',
          resourceType: 'asset-topology.room',
          resourceId: roomId,
          sequence,
          changes: [{ field: 'status', before: 'ACTIVE', after: 'RETIRED' }],
        }),
        context,
      );
      return retired;
    });
  }

  async updateRoom(
    roomId: RoomId,
    input: UpdateRoomInput,
    actor: TopologyActor,
  ): Promise<Room> {
    return this.unitOfWork.run(async (context) => {
      const current = await this.store.getRoom(roomId, context);
      if (!current) throw new TopologyResourceNotFoundError('Room');
      if (current.status === 'RETIRED') {
        throw new DomainError('ROOM_RETIRED', 'Retired Room cannot be updated');
      }

      const layoutRequested =
        input.widthMm !== undefined ||
        input.depthMm !== undefined ||
        input.gridSnapMm !== undefined ||
        input.walkwayCells !== undefined;
      if (layoutRequested && input.expectedLayoutRevision === undefined) {
        throw new DomainError(
          'ROOM_LAYOUT_REVISION_REQUIRED',
          'Expected Room layout revision is required for layout changes',
        );
      }
      if (
        layoutRequested &&
        input.expectedLayoutRevision !== current.layoutRevision
      ) {
        throw new RoomLayoutRevisionConflictError();
      }

      const widthMm = input.widthMm ?? current.roomMap.widthMm;
      const depthMm = input.depthMm ?? current.roomMap.depthMm;
      const gridSnapMm = input.gridSnapMm ?? current.roomMap.gridSnapMm;
      if (input.widthMm !== undefined || input.depthMm !== undefined) {
        const columns = Math.floor(widthMm / gridSnapMm);
        const rows = Math.floor(depthMm / gridSnapMm);
        if (
          current.roomMap.walkwayCells.some(
            (cell) => cell.column >= columns || cell.row >= rows,
          )
        ) {
          throw new DomainError(
            'ROOM_GRID_CHANGE_INVALIDATES_LAYOUT',
            'Room dimensions cannot exclude an existing walkway cell',
          );
        }
      }

      const roomMap = RoomMap.create({
        widthMm,
        depthMm,
        gridSnapMm,
        walkwayCells: input.walkwayCells ?? current.roomMap.walkwayCells,
      });

      const layoutChanged =
        current.roomMap.widthMm !== roomMap.widthMm ||
        current.roomMap.depthMm !== roomMap.depthMm ||
        current.roomMap.gridSnapMm !== roomMap.gridSnapMm ||
        !sameRoomMapCells(current.roomMap.walkwayCells, roomMap.walkwayCells);
      const advancedRoom = layoutChanged
        ? await this.store.advanceRoomLayoutRevision(
            roomId,
            input.expectedLayoutRevision!,
            context,
          )
        : null;
      if (layoutChanged && !advancedRoom)
        throw new RoomLayoutRevisionConflictError();

      const activeRackLocations = layoutChanged
        ? await this.requireRackStore().listActiveLocationsInRoom(
            roomId,
            context,
          )
        : [];
      if (layoutChanged) {
        const occupiedWalkway = roomMap.walkwayCells.find((cell) =>
          activeRackLocations.some(
            ({ placement }) =>
              placement.column === cell.column && placement.row === cell.row,
          ),
        );
        if (occupiedWalkway) {
          throw new DomainError(
            'WALKWAY_CELL_OCCUPIED_BY_RACK',
            'A Rack currently occupies a requested walkway cell',
          );
        }
        RoomMapChangePolicy.validate(
          current.roomMap,
          roomMap,
          activeRackLocations.map((location) => location.placement),
        );
      }

      const updated = current.update({
        name: input.name ?? current.name,
        roomMap,
        ...(advancedRoom
          ? { layoutRevision: advancedRoom.layoutRevision }
          : {}),
      });
      const changes = [
        ...(current.name === updated.name
          ? []
          : [{ field: 'name', before: current.name, after: updated.name }]),
        ...(current.roomMap.widthMm === roomMap.widthMm
          ? []
          : [
              {
                field: 'width_mm',
                before: current.roomMap.widthMm,
                after: roomMap.widthMm,
              },
            ]),
        ...(current.roomMap.depthMm === roomMap.depthMm
          ? []
          : [
              {
                field: 'depth_mm',
                before: current.roomMap.depthMm,
                after: roomMap.depthMm,
              },
            ]),
        ...(current.roomMap.gridSnapMm === roomMap.gridSnapMm
          ? []
          : [
              {
                field: 'grid_snap_mm',
                before: current.roomMap.gridSnapMm,
                after: roomMap.gridSnapMm,
              },
            ]),
        ...(sameRoomMapCells(current.roomMap.walkwayCells, roomMap.walkwayCells)
          ? []
          : [
              {
                field: 'walkway_cells',
                before: current.roomMap.walkwayCells.map(
                  (cell) => `${cell.column}:${cell.row}`,
                ),
                after: roomMap.walkwayCells.map(
                  (cell) => `${cell.column}:${cell.row}`,
                ),
              },
            ]),
      ];
      if (changes.length === 0) return current;

      const sequence = await this.store.saveRoom(updated, context);
      await this.outbox.append(
        this.createAuditFact({
          actor,
          action: 'asset_topology.room.updated',
          resourceType: 'asset-topology.room',
          resourceId: updated.id,
          sequence,
          changes,
        }),
        context,
      );
      return updated;
    });
  }

  private createAuditFact(input: {
    readonly actor: TopologyActor;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly sequence: number;
    readonly changes: AuditFactV2['payload']['changes'];
  }): AuditFactV2 {
    const occurredAt = this.now();
    return {
      event_id: this.generateId(),
      event_type: AUDIT_FACT_EVENT_TYPE,
      event_version: AUDIT_FACT_EVENT_VERSION_V2,
      producer: 'asset-topology',
      occurred_at: occurredAt.toISOString(),
      resource: {
        type: input.resourceType,
        id: input.resourceId,
        sequence: input.sequence,
      },
      payload: {
        actor: input.actor,
        action: input.action,
        changes: input.changes,
      },
      context: input.actor.context ?? {},
    };
  }

  private requireRackStore(): RackStorePort {
    if (!this.racks) {
      throw new Error('Rack store is required to change the Room layout');
    }
    return this.racks;
  }
}

function sameRoomMapCells(
  left: readonly RoomMapCell[],
  right: readonly RoomMapCell[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (cell, index) =>
        cell.column === right[index]?.column && cell.row === right[index]?.row,
    )
  );
}

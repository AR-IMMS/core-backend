import { Inject, Injectable } from '@nestjs/common';
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
import {
  RoomLayoutRevisionConflictError,
  type TopologyActor,
} from '../topology/topology-use-cases';
import type { TopologyStorePort } from '../topology/topology-store.port';
import { TOPOLOGY_STORE } from '../topology/topology-store.token';
import { Rack } from '../../domain/topology/rack';
import { RackLocation } from '../../domain/topology/rack-location';
import type { RackRotation } from '../../domain/topology/rack-map-placement';
import { RACK_STORE } from './rack-store.token';
import type { RackStorePort } from './rack-store.port';
import { RACK_CLOCK, RACK_ID_GENERATOR } from './rack-runtime.token';
import { DomainError } from '../../domain/shared/domain-error';

export interface CreateRackInput {
  readonly roomId: string;
  readonly column: number;
  readonly row: number;
  readonly rotation: RackRotation;
  readonly uCapacity: number;
  readonly name: string;
  readonly expectedLayoutRevision: number;
}

export interface UpdateRackInput {
  readonly name?: string;
  readonly uCapacity?: number;
}

export interface MoveRackInput {
  readonly roomId: string;
  readonly column: number;
  readonly row: number;
  readonly rotation: RackRotation;
  readonly expectedLayoutRevision: number;
  readonly expectedSourceLayoutRevision?: number;
}

export interface RackLayoutMutationResult<T> {
  readonly value: T;
  readonly layoutRevisions: readonly {
    readonly roomId: string;
    readonly revision: number;
  }[];
}

export class RackResourceNotFoundError extends Error {
  constructor(resource: 'Rack' | 'Room') {
    super(`${resource} was not found`);
    this.name = 'RackResourceNotFoundError';
  }
}

/** Rack create, metadata update, and atomic Room-map location operations. */
@Injectable()
export class RackManagementUseCases {
  constructor(
    @Inject(RACK_STORE) private readonly racks: RackStorePort,
    @Inject(TOPOLOGY_STORE) private readonly topology: TopologyStorePort,
    @Inject(UNIT_OF_WORK_PORT) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(OUTBOX_WRITER_PORT) private readonly outbox: OutboxWriterPort,
    @Inject(RACK_CLOCK) private readonly now: () => Date = () => new Date(),
    @Inject(RACK_ID_GENERATOR)
    private readonly generateId: () => string = randomUUID,
  ) {}

  async create(
    input: CreateRackInput,
    actor: TopologyActor,
  ): Promise<RackLayoutMutationResult<Rack>> {
    return this.unitOfWork.run(async (context) => {
      const room = await this.topology.getRoom(input.roomId, context);
      if (!room) throw new RackResourceNotFoundError('Room');
      if (room.status === 'RETIRED') {
        throw new DomainError('ROOM_RETIRED', 'Retired Room cannot hold Racks');
      }
      const advancedRoom = await this.topology.advanceRoomLayoutRevision(
        room.id,
        input.expectedLayoutRevision,
        context,
      );
      if (!advancedRoom) throw new RoomLayoutRevisionConflictError();
      const rack = Rack.create({
        id: this.generateId(),
        name: input.name,
        uCapacity: input.uCapacity,
      });
      const locations = await this.racks.listActiveLocationsInRoom(
        room.id,
        context,
      );
      const location = RackLocation.start(
        {
          rackId: rack.id,
          roomId: room.id,
          column: input.column,
          row: input.row,
          rotation: input.rotation,
          locatedAt: this.now(),
        },
        room.roomMap,
        locations.map((item) => item.placement),
      );
      const sequence = await this.racks.saveRack(rack, context);
      await this.racks.saveLocation(location, context);
      await this.appendFact(
        {
          actor,
          action: 'asset_topology.rack.created',
          rack,
          sequence,
          changes: [
            { field: 'name', after: rack.name },
            { field: 'u_capacity', after: rack.uCapacity },
            { field: 'room_id', after: room.id },
            { field: 'column', after: input.column },
            { field: 'row', after: input.row },
            { field: 'rotation', after: input.rotation },
          ],
        },
        context,
      );
      return {
        value: rack,
        layoutRevisions: [
          { roomId: room.id, revision: advancedRoom.layoutRevision },
        ],
      };
    });
  }

  async update(
    rackId: string,
    input: UpdateRackInput,
    actor: TopologyActor,
  ): Promise<Rack> {
    return this.unitOfWork.run(async (context) => {
      const current = await this.racks.getRack(rackId, context);
      if (!current) throw new RackResourceNotFoundError('Rack');
      const updated = current.update(input);
      const changes: AuditFactV2['payload']['changes'] = [
        ...(current.name === updated.name
          ? []
          : [
              {
                field: 'name',
                before: current.name,
                after: updated.name,
              },
            ]),
        ...(current.uCapacity === updated.uCapacity
          ? []
          : [
              {
                field: 'u_capacity',
                before: current.uCapacity,
                after: updated.uCapacity,
              },
            ]),
      ];
      if (changes.length === 0) return current;
      const sequence = await this.racks.saveRack(updated, context);
      await this.appendFact(
        {
          actor,
          action: 'asset_topology.rack.updated',
          rack: updated,
          sequence,
          changes,
        },
        context,
      );
      return updated;
    });
  }

  async move(
    rackId: string,
    input: MoveRackInput,
    actor: TopologyActor,
  ): Promise<RackLayoutMutationResult<RackLocation>> {
    return this.unitOfWork.run(async (context) => {
      const rack = await this.racks.getRack(rackId, context);
      if (!rack) throw new RackResourceNotFoundError('Rack');
      const current = await this.racks.getActiveLocation(rack.id, context);
      if (!current) throw new RackResourceNotFoundError('Rack');
      const room = await this.topology.getRoom(input.roomId, context);
      if (!room) throw new RackResourceNotFoundError('Room');
      if (room.status === 'RETIRED') {
        throw new DomainError('ROOM_RETIRED', 'Retired Room cannot hold Racks');
      }
      if (
        current.roomId === input.roomId &&
        current.placement.column === input.column &&
        current.placement.row === input.row &&
        current.placement.rotation === input.rotation
      ) {
        if (room.layoutRevision !== input.expectedLayoutRevision)
          throw new RoomLayoutRevisionConflictError();
        return {
          value: current,
          layoutRevisions: [{ roomId: room.id, revision: room.layoutRevision }],
        };
      }
      const sourceRoom =
        current.roomId === room.id
          ? room
          : await this.topology.getRoom(current.roomId, context);
      if (!sourceRoom) throw new RackResourceNotFoundError('Room');
      if (
        current.roomId !== room.id &&
        input.expectedSourceLayoutRevision === undefined
      )
        throw new DomainError(
          'ROOM_LAYOUT_REVISION_REQUIRED',
          'Expected source Room layout revision is required for cross-Room moves',
        );
      const revisionsToAdvance =
        current.roomId === room.id
          ? [{ id: room.id, expected: input.expectedLayoutRevision }]
          : [
              {
                id: sourceRoom.id,
                expected: input.expectedSourceLayoutRevision!,
              },
              { id: room.id, expected: input.expectedLayoutRevision },
            ].sort((left, right) => left.id.localeCompare(right.id));
      const advancedRooms: { roomId: string; revision: number }[] = [];
      for (const revision of revisionsToAdvance) {
        const advanced = await this.topology.advanceRoomLayoutRevision(
          revision.id,
          revision.expected,
          context,
        );
        if (!advanced) throw new RoomLayoutRevisionConflictError();
        advancedRooms.push({
          roomId: advanced.id,
          revision: advanced.layoutRevision,
        });
      }
      const otherLocations = (
        await this.racks.listActiveLocationsInRoom(room.id, context)
      ).filter((item) => item.rackId !== rack.id);
      const locatedAt = this.now();
      const result = current.relocate(
        {
          rackId: rack.id,
          roomId: room.id,
          column: input.column,
          row: input.row,
          rotation: input.rotation,
          locatedAt,
        },
        room.roomMap,
        otherLocations.map((item) => item.placement),
      );
      await this.racks.closeActiveLocation(rack.id, locatedAt, context);
      await this.racks.saveLocation(result.activeLocation, context);
      const sequence = await this.racks.saveRack(rack, context);
      await this.appendFact(
        {
          actor,
          action: 'asset_topology.rack.location_changed',
          rack,
          sequence,
          changes: [
            { field: 'room_id', before: current.roomId, after: room.id },
            {
              field: 'column',
              before: current.placement.column,
              after: input.column,
            },
            { field: 'row', before: current.placement.row, after: input.row },
            {
              field: 'rotation',
              before: current.placement.rotation,
              after: input.rotation,
            },
          ],
        },
        context,
      );
      return { value: result.activeLocation, layoutRevisions: advancedRooms };
    });
  }

  private async appendFact(
    input: {
      actor: TopologyActor;
      action: string;
      rack: Rack;
      sequence: number;
      changes: AuditFactV2['payload']['changes'];
    },
    context: Parameters<OutboxWriterPort['append']>[1],
  ): Promise<void> {
    const occurredAt = this.now();
    await this.outbox.append(
      {
        event_id: this.generateId(),
        event_type: AUDIT_FACT_EVENT_TYPE,
        event_version: AUDIT_FACT_EVENT_VERSION_V2,
        producer: 'asset-topology',
        occurred_at: occurredAt.toISOString(),
        resource: {
          type: 'asset-topology.rack',
          id: input.rack.id,
          sequence: input.sequence,
        },
        payload: {
          actor: input.actor,
          action: input.action,
          changes: input.changes,
        },
        context: input.actor.context ?? {},
      },
      context,
    );
  }
}

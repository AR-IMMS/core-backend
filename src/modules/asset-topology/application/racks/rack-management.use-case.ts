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
import type { TopologyActor } from '../topology/topology-use-cases';
import type { TopologyStorePort } from '../topology/topology-store.port';
import { TOPOLOGY_STORE } from '../topology/topology-store.token';
import { Rack } from '../../domain/topology/rack';
import { RackLocation } from '../../domain/topology/rack-location';
import type { RackRotation } from '../../domain/topology/rack-map-placement';
import { RACK_STORE } from './rack-store.token';
import type { RackStorePort } from './rack-store.port';

export interface CreateRackInput {
  readonly roomId: string;
  readonly column: number;
  readonly row: number;
  readonly rotation: RackRotation;
  readonly uCapacity: number;
  readonly rowLabel?: string;
  readonly positionInRow?: string;
}

export interface UpdateRackInput {
  readonly uCapacity?: number;
  readonly rowLabel?: string | null;
  readonly positionInRow?: string | null;
}

export interface MoveRackInput {
  readonly roomId: string;
  readonly column: number;
  readonly row: number;
  readonly rotation: RackRotation;
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
    private readonly now: () => Date = () => new Date(),
    private readonly generateId: () => string = randomUUID,
  ) {}

  async create(input: CreateRackInput, actor: TopologyActor): Promise<Rack> {
    return this.unitOfWork.run(async (context) => {
      const room = await this.topology.getRoom(input.roomId, context);
      if (!room) throw new RackResourceNotFoundError('Room');
      const rack = Rack.create({
        id: this.generateId(),
        uCapacity: input.uCapacity,
        rowLabel: input.rowLabel,
        positionInRow: input.positionInRow,
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
            { field: 'u_capacity', after: rack.uCapacity },
            ...(rack.rowLabel
              ? [{ field: 'row_label', after: rack.rowLabel }]
              : []),
            ...(rack.positionInRow
              ? [{ field: 'position_in_row', after: rack.positionInRow }]
              : []),
            { field: 'room_id', after: room.id },
            { field: 'column', after: input.column },
            { field: 'row', after: input.row },
            { field: 'rotation', after: input.rotation },
          ],
        },
        context,
      );
      return rack;
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
        ...(current.uCapacity === updated.uCapacity
          ? []
          : [
              {
                field: 'u_capacity',
                before: current.uCapacity,
                after: updated.uCapacity,
              },
            ]),
        ...(current.rowLabel === updated.rowLabel
          ? []
          : [
              {
                field: 'row_label',
                before: current.rowLabel ?? null,
                after: updated.rowLabel ?? null,
              },
            ]),
        ...(current.positionInRow === updated.positionInRow
          ? []
          : [
              {
                field: 'position_in_row',
                before: current.positionInRow ?? null,
                after: updated.positionInRow ?? null,
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
  ): Promise<RackLocation> {
    return this.unitOfWork.run(async (context) => {
      const rack = await this.racks.getRack(rackId, context);
      if (!rack) throw new RackResourceNotFoundError('Rack');
      const current = await this.racks.getActiveLocation(rack.id, context);
      if (!current) throw new RackResourceNotFoundError('Rack');
      if (
        current.roomId === input.roomId &&
        current.placement.column === input.column &&
        current.placement.row === input.row &&
        current.placement.rotation === input.rotation
      )
        return current;
      const room = await this.topology.getRoom(input.roomId, context);
      if (!room) throw new RackResourceNotFoundError('Room');
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
      return result.activeLocation;
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

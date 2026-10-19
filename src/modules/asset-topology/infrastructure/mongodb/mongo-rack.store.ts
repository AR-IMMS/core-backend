import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import { Rack } from '../../domain/topology/rack';
import { RackLocation } from '../../domain/topology/rack-location';
import type { RackStorePort } from '../../application/racks/rack-store.port';
import {
  TOPOLOGY_RACK_LOCATION_MODEL,
  TOPOLOGY_RACK_MODEL,
} from './topology.schema';

interface Query<TResult> {
  select(fields: string): Query<TResult>;
  sort(fields: Record<string, 1 | -1>): Query<TResult>;
  session(session: ClientSession): Query<TResult>;
  lean(): { exec(): Promise<TResult> };
  exec(): Promise<TResult>;
}
interface Model<T> {
  find(filter: Record<string, unknown>): Query<T[]>;
  findOne(filter: Record<string, unknown>): Query<T | null>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Query<T | null>;
}
interface RackDocument {
  id: string;
  uCapacity: number;
  rowLabel?: string;
  positionInRow?: string;
  auditSequence: number;
}
interface LocationDocument {
  id: string;
  rackId: string;
  roomId: string;
  column: number;
  row: number;
  rotation: 0 | 90 | 180 | 270;
  validFrom: Date;
  validTo?: Date;
}

/** Mongo adapter for Rack identity and location history. */
@Injectable()
export class MongoRackStore implements RackStorePort {
  constructor(
    @InjectModel(TOPOLOGY_RACK_MODEL)
    private readonly racks: Model<RackDocument>,
    @InjectModel(TOPOLOGY_RACK_LOCATION_MODEL)
    private readonly locations: Model<LocationDocument>,
  ) {}

  async getRack(id: string, context?: UnitOfWorkContext): Promise<Rack | null> {
    let query = this.racks.findOne({ id });
    if (context) query = query.session(context as unknown as ClientSession);
    const doc = await query.lean().exec();
    return doc ? toRack(doc) : null;
  }

  async listRacks(): Promise<readonly Rack[]> {
    const docs = await this.racks.find({}).sort({ id: 1 }).lean().exec();
    return docs.map(toRack);
  }

  async listActiveLocationsInRoom(
    roomId: string,
    context?: UnitOfWorkContext,
  ): Promise<readonly RackLocation[]> {
    let query = this.locations
      .find({ roomId, validTo: { $exists: false } })
      .sort({ column: 1, row: 1 });
    if (context) query = query.session(context as unknown as ClientSession);
    const docs = await query.lean().exec();
    return docs.map(toLocation);
  }

  async getActiveLocation(
    rackId: string,
    context?: UnitOfWorkContext,
  ): Promise<RackLocation | null> {
    let query = this.locations.findOne({ rackId, validTo: { $exists: false } });
    if (context) query = query.session(context as unknown as ClientSession);
    const doc = await query.lean().exec();
    return doc ? toLocation(doc) : null;
  }

  async listLocationHistory(rackId: string): Promise<readonly RackLocation[]> {
    const docs = await this.locations
      .find({ rackId })
      .sort({ validFrom: 1, id: 1 })
      .lean()
      .exec();
    return docs.map(toLocation);
  }

  async saveRack(rack: Rack, context: UnitOfWorkContext): Promise<number> {
    const set: Record<string, unknown> = { uCapacity: rack.uCapacity };
    const unset: Record<string, ''> = {};
    if (rack.rowLabel === undefined) unset.rowLabel = '';
    else set.rowLabel = rack.rowLabel;
    if (rack.positionInRow === undefined) unset.positionInRow = '';
    else set.positionInRow = rack.positionInRow;
    const update: Record<string, unknown> = {
      $set: set,
      $setOnInsert: { id: rack.id },
      $inc: { auditSequence: 1 },
    };
    if (Object.keys(unset).length) update.$unset = unset;
    const result = await this.racks
      .findOneAndUpdate({ id: rack.id }, update, {
        upsert: true,
        new: true,
        session: context,
      })
      .lean()
      .exec();
    if (!result) throw new Error('Rack save did not return its Audit sequence');
    return result.auditSequence;
  }

  async closeActiveLocation(
    rackId: string,
    validTo: Date,
    context: UnitOfWorkContext,
  ): Promise<void> {
    const result = await this.locations
      .findOneAndUpdate(
        { rackId, validTo: { $exists: false } },
        { $set: { validTo } },
        { new: true, session: context },
      )
      .lean()
      .exec();
    if (!result)
      throw new Error('Active Rack location disappeared during move');
  }

  async saveLocation(
    location: RackLocation,
    context: UnitOfWorkContext,
  ): Promise<void> {
    const id = randomUUID();
    await this.locations
      .findOneAndUpdate(
        { id },
        {
          $setOnInsert: {
            id,
            rackId: location.rackId,
            roomId: location.roomId,
            column: location.placement.column,
            row: location.placement.row,
            rotation: location.placement.rotation,
            validFrom: location.validFrom,
          },
        },
        {
          upsert: true,
          new: true,
          session: context,
        },
      )
      .lean()
      .exec();
  }
}

function toRack(doc: RackDocument): Rack {
  return Rack.create({
    id: doc.id,
    uCapacity: doc.uCapacity,
    rowLabel: doc.rowLabel,
    positionInRow: doc.positionInRow,
  });
}

function toLocation(doc: LocationDocument): RackLocation {
  return RackLocation.fromHistory({
    rackId: doc.rackId,
    roomId: doc.roomId,
    column: doc.column,
    row: doc.row,
    rotation: doc.rotation,
    validFrom: doc.validFrom,
    validTo: doc.validTo,
  });
}

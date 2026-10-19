import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import { Room } from '../../domain/topology/room';
import type { RoomId } from '../../domain/topology/room';
import { RoomMap } from '../../domain/topology/room-map';
import type {
  DataCenterId,
  DataCenterReference,
} from '../../domain/topology/data-center';
import { Site } from '../../domain/topology/site';
import type { SiteId } from '../../domain/topology/site';
import type { TopologyStorePort } from '../../application/topology/topology-store.port';
import {
  TOPOLOGY_DATA_CENTER_MODEL,
  TOPOLOGY_ROOM_MODEL,
  TOPOLOGY_SITE_MODEL,
} from './topology.schema';

interface LeanQuery<TResult> {
  exec(): Promise<TResult>;
}

interface MongoQuery<TResult> {
  select(fields: string): MongoQuery<TResult>;
  sort(fields: Record<string, 1 | -1>): MongoQuery<TResult>;
  session(session: ClientSession): MongoQuery<TResult>;
  lean(): LeanQuery<TResult>;
  exec(): Promise<TResult>;
}

interface MongoWriteOptions {
  readonly upsert?: boolean;
  readonly new?: boolean;
  readonly setDefaultsOnInsert?: boolean;
  readonly session?: ClientSession;
}

interface TopologyDataCenterDocument {
  readonly id: string;
  readonly name: string;
}

interface TopologySiteDocument {
  readonly id: string;
  readonly name: string;
  readonly dataCenterId: string;
  readonly auditSequence: number;
}

interface TopologyRoomDocument {
  readonly id: string;
  readonly name: string;
  readonly siteId: string;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly gridSnapMm: number;
  readonly auditSequence: number;
}

export interface MongoTopologyDataCenterModel {
  findOne(
    filter: Record<string, unknown>,
  ): MongoQuery<TopologyDataCenterDocument | null>;
}

export interface MongoTopologySiteModel {
  find(filter: Record<string, unknown>): MongoQuery<TopologySiteDocument[]>;
  findOne(
    filter: Record<string, unknown>,
  ): MongoQuery<TopologySiteDocument | null>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: MongoWriteOptions,
  ): MongoQuery<Pick<TopologySiteDocument, 'auditSequence'> | null>;
}

export interface MongoTopologyRoomModel {
  find(filter: Record<string, unknown>): MongoQuery<TopologyRoomDocument[]>;
  findOne(
    filter: Record<string, unknown>,
  ): MongoQuery<TopologyRoomDocument | null>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: MongoWriteOptions,
  ): MongoQuery<Pick<TopologyRoomDocument, 'auditSequence'> | null>;
}

/** MongoDB adapter for Asset & Topology location records. */
@Injectable()
export class MongoTopologyStore implements TopologyStorePort {
  constructor(
    @InjectModel(TOPOLOGY_DATA_CENTER_MODEL)
    private readonly dataCenters: MongoTopologyDataCenterModel,
    @InjectModel(TOPOLOGY_SITE_MODEL)
    private readonly sites: MongoTopologySiteModel,
    @InjectModel(TOPOLOGY_ROOM_MODEL)
    private readonly rooms: MongoTopologyRoomModel,
  ) {}

  async getDataCenter(id: string): Promise<DataCenterReference | null> {
    const dataCenter = await this.dataCenters
      .findOne({ id })
      .select('id name')
      .lean()
      .exec();
    return dataCenter
      ? { id: dataCenter.id as DataCenterId, name: dataCenter.name }
      : null;
  }

  async listSites(dataCenterId: string): Promise<readonly Site[]> {
    const sites = await this.sites
      .find({ dataCenterId })
      .sort({ name: 1, id: 1 })
      .lean()
      .exec();
    return sites.map(toSite);
  }

  async getSite(id: string): Promise<Site | null> {
    const site = await this.sites.findOne({ id }).lean().exec();
    return site ? toSite(site) : null;
  }

  async saveSite(site: Site, context: UnitOfWorkContext): Promise<number> {
    const result = await this.sites
      .findOneAndUpdate(
        { id: site.id },
        {
          $set: { name: site.name },
          $setOnInsert: { id: site.id, dataCenterId: site.dataCenterId },
          $inc: { auditSequence: 1 },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: false,
          session: context as unknown as ClientSession,
        },
      )
      .lean()
      .exec();
    if (!result) throw new Error('Site save did not return its Audit sequence');
    return result.auditSequence;
  }

  async listRooms(siteId: string): Promise<readonly Room[]> {
    const rooms = await this.rooms
      .find({ siteId })
      .sort({ name: 1, id: 1 })
      .lean()
      .exec();
    return rooms.map(toRoom);
  }

  async getRoom(id: string, context?: UnitOfWorkContext): Promise<Room | null> {
    let query = this.rooms.findOne({ id });
    if (context) query = query.session(context as unknown as ClientSession);
    const room = await query.lean().exec();
    return room ? toRoom(room) : null;
  }

  async saveRoom(room: Room, context: UnitOfWorkContext): Promise<number> {
    const result = await this.rooms
      .findOneAndUpdate(
        { id: room.id },
        {
          $set: {
            name: room.name,
            widthMm: room.roomMap.widthMm,
            depthMm: room.roomMap.depthMm,
            gridSnapMm: room.roomMap.gridSnapMm,
          },
          $setOnInsert: { id: room.id, siteId: room.siteId },
          $inc: { auditSequence: 1 },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: false,
          session: context as unknown as ClientSession,
        },
      )
      .lean()
      .exec();
    if (!result) throw new Error('Room save did not return its Audit sequence');
    return result.auditSequence;
  }
}

function toSite(document: TopologySiteDocument): Site {
  return Site.create({
    id: document.id as SiteId,
    name: document.name,
    dataCenterId: document.dataCenterId as DataCenterId,
  });
}

function toRoom(document: TopologyRoomDocument): Room {
  return Room.create({
    id: document.id as RoomId,
    name: document.name,
    siteId: document.siteId as SiteId,
    roomMap: RoomMap.create({
      widthMm: document.widthMm,
      depthMm: document.depthMm,
      gridSnapMm: document.gridSnapMm,
    }),
  });
}

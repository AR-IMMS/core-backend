import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import {
  ActiveAssetPlacementNotFoundError,
  AssetPlacementConflictError,
  type AssetPlacementStorePort,
} from '../../application/placements/asset-placement-store.port';
import { AssetPlacement } from '../../domain/placement/asset-placement';
import { ASSET_TOPOLOGY_ASSET_LOCATION_MODEL } from './asset-placement.schema';

interface Query<TResult> {
  sort(fields: Record<string, 1 | -1>): Query<TResult>;
  session(session: ClientSession): Query<TResult>;
  lean(): { exec(): Promise<TResult> };
  exec(): Promise<TResult>;
}
interface WriteResult {
  modifiedCount: number;
}
interface Model<T> {
  find(filter: Record<string, unknown>): Query<T[]>;
  findOne(filter: Record<string, unknown>): Query<T | null>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Query<T | null>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Query<WriteResult>;
}
interface AssetLocationDocument {
  id: string;
  assetId: string;
  rackId: string;
  uPosition: number;
  validFrom: Date;
  validTo?: Date;
}

/** Mongo persistence for Asset Location intervals. */
@Injectable()
export class MongoAssetPlacementStore implements AssetPlacementStorePort {
  constructor(
    @InjectModel(ASSET_TOPOLOGY_ASSET_LOCATION_MODEL)
    private readonly locations: Model<AssetLocationDocument>,
  ) {}

  async findActiveByAsset(
    assetId: string,
    context?: UnitOfWorkContext,
  ): Promise<AssetPlacement | null> {
    let query = this.locations.findOne({
      assetId,
      validTo: { $exists: false },
    });
    if (context) query = query.session(context as unknown as ClientSession);
    const doc = await query.lean().exec();
    return doc ? toPlacement(doc) : null;
  }

  async findActiveByRackU(
    rackId: string,
    uPosition: number,
    context?: UnitOfWorkContext,
  ): Promise<AssetPlacement | null> {
    let query = this.locations.findOne({
      rackId,
      uPosition,
      validTo: { $exists: false },
    });
    if (context) query = query.session(context as unknown as ClientSession);
    const doc = await query.lean().exec();
    return doc ? toPlacement(doc) : null;
  }

  async listActiveByAssetIds(
    assetIds: readonly string[],
  ): Promise<readonly AssetPlacement[]> {
    if (!assetIds.length) return [];
    const docs = await this.locations
      .find({ assetId: { $in: assetIds }, validTo: { $exists: false } })
      .sort({ assetId: 1 })
      .lean()
      .exec();
    return docs.map(toPlacement);
  }

  async listHistoryByAsset(
    assetId: string,
  ): Promise<readonly AssetPlacement[]> {
    const docs = await this.locations
      .find({ assetId })
      .sort({ validFrom: 1, id: 1 })
      .lean()
      .exec();
    return docs.map(toPlacement);
  }

  async save(
    placement: AssetPlacement,
    context: UnitOfWorkContext,
  ): Promise<void> {
    try {
      await this.locations
        .findOneAndUpdate(
          { id: placement.id },
          {
            $setOnInsert: {
              id: placement.id,
              assetId: placement.assetId,
              rackId: placement.rackId,
              uPosition: placement.uPosition.value,
              validFrom: placement.validFrom,
            },
          },
          { upsert: true, new: true, session: context },
        )
        .lean()
        .exec();
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new AssetPlacementConflictError();
      throw error;
    }
  }

  async closeActive(
    assetId: string,
    validTo: Date,
    context: UnitOfWorkContext,
  ): Promise<void> {
    const result = await this.locations
      .updateOne(
        { assetId, validTo: { $exists: false } },
        { $set: { validTo } },
        { session: context },
      )
      .exec();
    if (!result.modifiedCount)
      throw new ActiveAssetPlacementNotFoundError(assetId);
  }
}

function toPlacement(doc: AssetLocationDocument): AssetPlacement {
  const placement = AssetPlacement.start({
    id: doc.id,
    assetId: doc.assetId,
    rackId: doc.rackId,
    uPosition: doc.uPosition,
    placedAt: doc.validFrom,
  });
  return doc.validTo ? placement.close(doc.validTo) : placement;
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

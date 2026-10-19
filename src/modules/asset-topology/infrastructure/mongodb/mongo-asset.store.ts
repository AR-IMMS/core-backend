import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import type { AssetCatalogStorePort } from '../../application/assets/asset-catalog.port';
import type { AssetStorePort } from '../../application/assets/asset-store.port';
import { Asset } from '../../domain/asset/asset';
import type {
  AssetModelReference,
  AssetTypeReference,
} from '../../domain/asset/asset';
import {
  ASSET_MODEL,
  ASSET_MODEL_MODEL,
  ASSET_TYPE_MODEL,
} from './asset.schema';

interface LeanQuery<T> {
  exec(): Promise<T>;
}
interface MongoQuery<T> {
  session(session: ClientSession): MongoQuery<T>;
  select(fields: string): MongoQuery<T>;
  sort(fields: Record<string, 1 | -1>): MongoQuery<T>;
  limit(count: number): MongoQuery<T>;
  lean(): LeanQuery<T>;
  exec(): Promise<T>;
}
interface AssetDocument {
  id: string;
  name: string;
  assetTypeId: string;
  assetModelId?: string;
  serialNumber?: string;
  lifecycleState: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';
  auditSequence: number;
}
interface CatalogDocument {
  id: string;
  assetTypeId?: string;
}
interface Model<T> {
  findOne(filter: Record<string, unknown>): MongoQuery<T | null>;
  find(filter: Record<string, unknown>): MongoQuery<T[]>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ): MongoQuery<T | null>;
}

/** Mongo persistence for Assets and their read-only Type/Model catalog. */
@Injectable()
export class MongoAssetStore implements AssetStorePort, AssetCatalogStorePort {
  constructor(
    @InjectModel(ASSET_MODEL) private readonly assets: Model<AssetDocument>,
    @InjectModel(ASSET_TYPE_MODEL)
    private readonly types: Model<CatalogDocument>,
    @InjectModel(ASSET_MODEL_MODEL)
    private readonly models: Model<CatalogDocument>,
  ) {}

  async findType(
    typeId: string,
    context?: UnitOfWorkContext,
  ): Promise<AssetTypeReference | null> {
    let query = this.types.findOne({ id: typeId }).select('id');
    if (context) query = query.session(context as unknown as ClientSession);
    const found = await query.lean().exec();
    return found ? { id: found.id } : null;
  }

  async findModel(
    modelId: string,
    context?: UnitOfWorkContext,
  ): Promise<AssetModelReference | null> {
    let query = this.models.findOne({ id: modelId }).select('id assetTypeId');
    if (context) query = query.session(context as unknown as ClientSession);
    const found = await query.lean().exec();
    return found?.assetTypeId
      ? { id: found.id, assetTypeId: found.assetTypeId }
      : null;
  }

  async findById(
    assetId: string,
    context?: UnitOfWorkContext,
  ): Promise<Asset | null> {
    let query = this.assets.findOne({ id: assetId });
    if (context) query = query.session(context as unknown as ClientSession);
    const found = await query.lean().exec();
    return found ? toAsset(found) : null;
  }

  async save(asset: Asset, context: UnitOfWorkContext): Promise<number> {
    const result = await this.assets
      .findOneAndUpdate(
        { id: asset.id },
        {
          $set: {
            name: asset.name,
            lifecycleState: asset.lifecycleState,
            ...(asset.assetModelId === undefined
              ? {}
              : { assetModelId: asset.assetModelId }),
            ...(asset.serialNumber === undefined
              ? {}
              : { serialNumber: asset.serialNumber }),
          },
          $unset: {
            ...(asset.assetModelId === undefined ? { assetModelId: 1 } : {}),
            ...(asset.serialNumber === undefined ? { serialNumber: 1 } : {}),
          },
          $setOnInsert: { id: asset.id, assetTypeId: asset.assetTypeId },
          $inc: { auditSequence: 1 },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: false,
          session: context,
        },
      )
      .lean()
      .exec();
    if (!result)
      throw new Error('Asset save did not return its Audit sequence');
    return result.auditSequence;
  }

  async list(input: {
    readonly afterAssetId?: string;
    readonly limit: number;
  }): Promise<{ readonly items: readonly Asset[]; readonly hasMore: boolean }> {
    const filter = input.afterAssetId
      ? { id: { $gt: input.afterAssetId } }
      : {};
    const found = await this.assets
      .find(filter)
      .sort({ id: 1 })
      .limit(input.limit + 1)
      .lean()
      .exec();
    return {
      items: found.slice(0, input.limit).map(toAsset),
      hasMore: found.length > input.limit,
    };
  }
}

function toAsset(document: AssetDocument): Asset {
  return Asset.restore(document);
}

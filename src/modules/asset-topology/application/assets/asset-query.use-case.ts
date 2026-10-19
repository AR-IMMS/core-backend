import { Inject, Injectable } from '@nestjs/common';
import type {
  AssetId,
  AssetReference,
  AssetTypeId,
  AssetTopologyAssetQueries,
} from '../../contracts';
import type { AssetStorePort } from './asset-store.port';
import { ASSET_STORE } from './asset-store.token';
import type { Asset } from '../../domain/asset/asset';

@Injectable()
export class GetAssetUseCase implements AssetTopologyAssetQueries {
  constructor(@Inject(ASSET_STORE) private readonly assets: AssetStorePort) {}

  async execute(assetId: AssetId): Promise<AssetReference | null> {
    const asset = await this.assets.findById(assetId);
    return asset ? toReference(asset) : null;
  }

  getAsset(assetId: AssetId): Promise<AssetReference | null> {
    return this.execute(assetId);
  }
}

@Injectable()
export class ListAssetsUseCase {
  constructor(@Inject(ASSET_STORE) private readonly assets: AssetStorePort) {}

  async execute(input: {
    readonly pageSize: number;
    readonly afterAssetId?: string;
  }): Promise<{
    readonly assets: readonly Asset[];
    readonly nextCursorAssetId: string | null;
  }> {
    const result = await this.assets.list({
      afterAssetId: input.afterAssetId,
      limit: input.pageSize,
    });
    const last = result.items.at(-1);
    return {
      assets: result.items,
      nextCursorAssetId: result.hasMore && last ? last.id : null,
    };
  }
}

function toReference(asset: Asset): AssetReference {
  return {
    id: asset.id as AssetId,
    name: asset.name,
    assetTypeId: asset.assetTypeId as AssetTypeId,
    lifecycleState: asset.lifecycleState,
    currentPlacement: null,
  };
}

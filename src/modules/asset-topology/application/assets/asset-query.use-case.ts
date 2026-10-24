import { Inject, Injectable } from '@nestjs/common';
import type {
  AssetId,
  AssetReference,
  RackId,
  AssetTypeId,
  AssetTopologyAssetQueries,
} from '../../contracts';
import type { AssetStorePort } from './asset-store.port';
import { ASSET_STORE } from './asset-store.token';
import type { Asset } from '../../domain/asset/asset';
import type { AssetPlacementStorePort } from '../placements/asset-placement-store.port';
import { ASSET_PLACEMENT_STORE } from '../placements/asset-placement-store.token';
import type {
  AssetCurrentPlacement,
  AssetPlacementHistoryEntry,
} from '../../contracts';

@Injectable()
export class GetAssetUseCase implements AssetTopologyAssetQueries {
  constructor(
    @Inject(ASSET_STORE) private readonly assets: AssetStorePort,
    @Inject(ASSET_PLACEMENT_STORE)
    private readonly placements: AssetPlacementStorePort,
  ) {}

  async execute(assetId: AssetId): Promise<AssetReference | null> {
    const asset = await this.assets.findById(assetId);
    if (!asset) return null;
    const placement = await this.placements.findActiveByAsset(asset.id);
    return toReference(
      asset,
      placement
        ? {
            rackId: placement.rackId as RackId,
            uPosition: placement.uPosition.value,
          }
        : null,
    );
  }

  getAsset(assetId: AssetId): Promise<AssetReference | null> {
    return this.execute(assetId);
  }

  async getAssetPlacementHistory(
    assetId: AssetId,
  ): Promise<readonly AssetPlacementHistoryEntry[] | null> {
    const asset = await this.assets.findById(assetId);
    if (!asset) return null;
    const history = await this.placements.listHistoryByAsset(assetId);
    return history.map((item) => ({
      rackId: item.rackId as RackId,
      uPosition: item.uPosition.value,
      validFrom: item.validFrom.toISOString(),
      validTo: item.validTo?.toISOString() ?? null,
    }));
  }
}

@Injectable()
export class ListAssetsUseCase {
  constructor(
    @Inject(ASSET_STORE) private readonly assets: AssetStorePort,
    @Inject(ASSET_PLACEMENT_STORE)
    private readonly placements: AssetPlacementStorePort,
  ) {}

  async execute(input: {
    readonly pageSize: number;
    readonly afterAssetId?: string;
  }): Promise<{
    readonly assets: readonly Asset[];
    readonly currentPlacements: ReadonlyMap<string, AssetCurrentPlacement>;
    readonly nextCursorAssetId: string | null;
  }> {
    const result = await this.assets.list({
      afterAssetId: input.afterAssetId,
      limit: input.pageSize,
    });
    const activePlacements = await this.placements.listActiveByAssetIds(
      result.items.map((item) => item.id),
    );
    const currentPlacements = new Map<string, AssetCurrentPlacement>(
      activePlacements.map((placement) => [
        placement.assetId,
        {
          rackId: placement.rackId as RackId,
          uPosition: placement.uPosition.value,
        },
      ]),
    );
    const last = result.items.at(-1);
    return {
      assets: result.items,
      currentPlacements,
      nextCursorAssetId: result.hasMore && last ? last.id : null,
    };
  }
}

function toReference(
  asset: Asset,
  currentPlacement: AssetCurrentPlacement | null,
): AssetReference {
  return {
    id: asset.id as AssetId,
    name: asset.name,
    assetTypeId: asset.assetTypeId as AssetTypeId,
    lifecycleState: asset.lifecycleState,
    currentPlacement,
  };
}

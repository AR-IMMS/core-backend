import type { UnitOfWorkContext } from '@platform/events';
import type { Asset } from '../../domain/asset/asset';

export interface AssetStorePort {
  findById(assetId: string, context?: UnitOfWorkContext): Promise<Asset | null>;
  save(asset: Asset, context: UnitOfWorkContext): Promise<number>;
  list(input: {
    readonly afterAssetId?: string;
    readonly limit: number;
  }): Promise<{ readonly items: readonly Asset[]; readonly hasMore: boolean }>;
}

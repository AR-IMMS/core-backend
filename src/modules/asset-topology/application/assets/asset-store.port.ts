import type { UnitOfWorkContext } from '@platform/events';
import type { Asset } from '../../domain/asset/asset';

export interface AssetStorePort {
  findById(assetId: string, context?: UnitOfWorkContext): Promise<Asset | null>;
  save(asset: Asset, context: UnitOfWorkContext): Promise<number>;
  serializeAgentEnrollmentEligibility(
    assetId: string,
    context: UnitOfWorkContext,
  ): Promise<boolean>;
  list(input: {
    readonly afterAssetId?: string;
    readonly limit: number;
    readonly assetTypeId?: string;
    readonly lifecycleState?: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';
    readonly assetIds?: readonly string[];
    readonly search?: string;
  }): Promise<{ readonly items: readonly Asset[]; readonly hasMore: boolean }>;
}

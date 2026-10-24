import type { UnitOfWorkContext } from '@platform/events';
import type { AssetPlacement } from '../../domain/placement/asset-placement';

/** Persistence boundary for current and historical Asset Location records. */
export interface AssetPlacementStorePort {
  findActiveByAsset(
    assetId: string,
    context?: UnitOfWorkContext,
  ): Promise<AssetPlacement | null>;
  findActiveByRackU(
    rackId: string,
    uPosition: number,
    context?: UnitOfWorkContext,
  ): Promise<AssetPlacement | null>;
  listActiveByAssetIds(
    assetIds: readonly string[],
  ): Promise<readonly AssetPlacement[]>;
  listHistoryByAsset(assetId: string): Promise<readonly AssetPlacement[]>;
  save(placement: AssetPlacement, context: UnitOfWorkContext): Promise<void>;
  closeActive(
    assetId: string,
    validTo: Date,
    context: UnitOfWorkContext,
  ): Promise<void>;
}

/** Raised when an atomic persistence uniqueness constraint rejects a race. */
export class AssetPlacementConflictError extends Error {
  constructor() {
    super('The Asset placement conflicts with a concurrent change');
    this.name = 'AssetPlacementConflictError';
  }
}

/** Raised when an expected active location could not be closed. */
export class ActiveAssetPlacementNotFoundError extends Error {
  constructor(assetId: string) {
    super(`Active placement for Asset ${assetId} was not found`);
    this.name = 'ActiveAssetPlacementNotFoundError';
  }
}

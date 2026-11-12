import { Inject, Injectable } from '@nestjs/common';
import type { UnitOfWorkContext } from '@platform/events';
import type {
  AssetId,
  AssetTopologyAgentEnrollmentCommands,
} from '../../contracts';
import type { AssetStorePort } from './asset-store.port';
import { ASSET_STORE } from './asset-store.token';
import type { AssetPlacementStorePort } from '../placements/asset-placement-store.port';
import { ASSET_PLACEMENT_STORE } from '../placements/asset-placement-store.token';

/** Serializes enrollment against Asset retirement in the caller's transaction. */
@Injectable()
export class AgentEnrollmentEligibilityUseCase implements AssetTopologyAgentEnrollmentCommands {
  constructor(
    @Inject(ASSET_STORE) private readonly assets: AssetStorePort,
    @Inject(ASSET_PLACEMENT_STORE)
    private readonly placements: AssetPlacementStorePort,
  ) {}

  async serializeAgentEnrollment(
    assetId: AssetId,
    context: UnitOfWorkContext,
  ): Promise<boolean> {
    const placement = await this.placements.findActiveByAsset(assetId, context);
    if (!placement) return false;
    return this.assets.serializeAgentEnrollmentEligibility(assetId, context);
  }
}

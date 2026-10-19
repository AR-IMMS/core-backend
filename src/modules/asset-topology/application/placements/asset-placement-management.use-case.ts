import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UnitOfWorkContext } from '@platform/events';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION_V2,
  OUTBOX_WRITER_PORT,
  UNIT_OF_WORK_PORT,
  type AuditFactV2,
  type OutboxWriterPort,
  type UnitOfWorkPort,
} from '@platform/events';
import { AssetPlacement } from '../../domain/placement/asset-placement';
import { AssetPlacementPolicy } from '../../domain/placement/asset-placement-policy';
import type { AssetStorePort } from '../assets/asset-store.port';
import { ASSET_STORE } from '../assets/asset-store.token';
import type { AssetActor } from '../assets/asset-registration.use-case';
import { AssetReferenceNotFoundError } from '../assets/asset-registration.use-case';
import type { RackStorePort } from '../racks/rack-store.port';
import { RACK_STORE } from '../racks/rack-store.token';
import {
  ActiveAssetPlacementNotFoundError,
  type AssetPlacementStorePort,
} from './asset-placement-store.port';
import { ASSET_PLACEMENT_STORE } from './asset-placement-store.token';
import { ASSET_CLOCK, ASSET_ID_GENERATOR } from '../assets/asset-runtime.token';

@Injectable()
export class AssetPlacementManagementUseCases {
  constructor(
    @Inject(ASSET_STORE) private readonly assets: AssetStorePort,
    @Inject(RACK_STORE) private readonly racks: RackStorePort,
    @Inject(ASSET_PLACEMENT_STORE)
    private readonly placements: AssetPlacementStorePort,
    @Inject(UNIT_OF_WORK_PORT) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(OUTBOX_WRITER_PORT) private readonly outbox: OutboxWriterPort,
    @Inject(ASSET_CLOCK) private readonly now: () => Date = () => new Date(),
    @Inject(ASSET_ID_GENERATOR)
    private readonly generateId: () => string = randomUUID,
  ) {}

  place(
    assetId: string,
    rackId: string,
    uPosition: number,
    actor: AssetActor,
  ): Promise<AssetPlacement> {
    return this.unitOfWork.run(async (context) => {
      const asset = await this.requireAsset(assetId, context);
      AssetPlacementPolicy.assertAssetEligible(asset);
      const existing = await this.placements.findActiveByAsset(
        assetId,
        context,
      );
      const rack = await this.requireRack(rackId, context);
      const occupant = await this.placements.findActiveByRackU(
        rackId,
        uPosition,
        context,
      );
      const placement = AssetPlacementPolicy.place(
        {
          id: this.generateId(),
          assetId,
          rackId,
          uPosition,
          placedAt: this.now(),
        },
        [existing, occupant].filter(
          (item): item is AssetPlacement => item !== null,
        ),
        [rack],
      );
      await this.placements.save(placement, context);
      await this.recordChange(
        asset,
        actor,
        context,
        'asset_topology.asset.placed',
        [
          { field: 'rack_id', after: rackId },
          { field: 'u_position', after: uPosition },
        ],
      );
      return placement;
    });
  }

  move(
    assetId: string,
    rackId: string,
    uPosition: number,
    actor: AssetActor,
  ): Promise<AssetPlacement> {
    return this.unitOfWork.run(async (context) => {
      const asset = await this.requireAsset(assetId, context);
      AssetPlacementPolicy.assertAssetEligible(asset);
      const current = await this.placements.findActiveByAsset(assetId, context);
      if (!current) throw new ActiveAssetPlacementNotFoundError(assetId);

      if (current.rackId === rackId && current.uPosition.value === uPosition)
        return current;

      const rack = await this.requireRack(rackId, context);
      const occupant = await this.placements.findActiveByRackU(
        rackId,
        uPosition,
        context,
      );
      const active = [current, occupant].filter(
        (item): item is AssetPlacement => item !== null,
      );
      const result = AssetPlacementPolicy.move(
        current,
        {
          id: this.generateId(),
          assetId,
          rackId,
          uPosition,
          placedAt: this.now(),
        },
        active,
        [rack],
      );
      await this.placements.closeActive(
        assetId,
        result.closedPlacement.validTo!,
        context,
      );
      await this.placements.save(result.activePlacement, context);
      await this.recordChange(
        asset,
        actor,
        context,
        'asset_topology.asset.moved',
        [
          { field: 'rack_id', before: current.rackId, after: rackId },
          {
            field: 'u_position',
            before: current.uPosition.value,
            after: uPosition,
          },
        ],
      );
      return result.activePlacement;
    });
  }

  unmap(assetId: string, actor: AssetActor): Promise<void> {
    return this.unitOfWork.run(async (context) => {
      const asset = await this.requireAsset(assetId, context);
      AssetPlacementPolicy.assertAssetEligible(asset);
      const current = await this.placements.findActiveByAsset(assetId, context);
      if (!current) throw new ActiveAssetPlacementNotFoundError(assetId);
      const closed = AssetPlacementPolicy.unmap(current, [current], this.now());
      await this.placements.closeActive(assetId, closed.validTo!, context);
      await this.recordChange(
        asset,
        actor,
        context,
        'asset_topology.asset.unmapped',
        [
          { field: 'rack_id', before: current.rackId },
          { field: 'u_position', before: current.uPosition.value },
        ],
      );
    });
  }

  private async requireAsset(assetId: string, context: UnitOfWorkContext) {
    const asset = await this.assets.findById(assetId, context);
    if (!asset) throw new AssetReferenceNotFoundError('Asset');
    return asset;
  }

  private async requireRack(rackId: string, context: UnitOfWorkContext) {
    const rack = await this.racks.getRack(rackId, context);
    if (!rack) throw new AssetReferenceNotFoundError('Rack');
    return rack;
  }

  private async recordChange(
    asset: import('../../domain/asset/asset').Asset,
    actor: AssetActor,
    context: UnitOfWorkContext,
    action: string,
    changes: AuditFactV2['payload']['changes'],
  ): Promise<void> {
    const sequence = await this.assets.save(asset, context);
    await this.outbox.append(
      {
        event_id: this.generateId(),
        event_type: AUDIT_FACT_EVENT_TYPE,
        event_version: AUDIT_FACT_EVENT_VERSION_V2,
        producer: 'asset-topology',
        occurred_at: this.now().toISOString(),
        resource: { type: 'asset-topology.asset', id: asset.id, sequence },
        payload: { actor, action, changes },
        context: actor.context ?? {},
      },
      context,
    );
  }
}

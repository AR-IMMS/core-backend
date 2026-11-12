import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION_V2,
  OUTBOX_WRITER_PORT,
  UNIT_OF_WORK_PORT,
  type AuditFactV2,
  type OutboxWriterPort,
  type UnitOfWorkPort,
} from '@platform/events';
import {
  AGENT_BINDING_QUERIES_PORT,
  type AgentBindingQueries,
} from '@modules/agent-management/contracts';
import type { AssetStorePort } from './asset-store.port';
import { ASSET_STORE } from './asset-store.token';
import type { AssetPlacementStorePort } from '../placements/asset-placement-store.port';
import { ASSET_PLACEMENT_STORE } from '../placements/asset-placement-store.token';
import { AssetReferenceNotFoundError } from './asset-registration.use-case';
import { AssetRetirementConflictError } from './asset-retirement.errors';
import type { AssetActor } from './asset-registration.use-case';
import { ASSET_CLOCK, ASSET_ID_GENERATOR } from './asset-runtime.token';

/** Retires an Asset without changing placement or Agent binding state. */
@Injectable()
export class RetireAssetUseCase {
  constructor(
    @Inject(ASSET_STORE) private readonly assets: AssetStorePort,
    @Inject(ASSET_PLACEMENT_STORE)
    private readonly placements: AssetPlacementStorePort,
    @Inject(AGENT_BINDING_QUERIES_PORT)
    private readonly bindings: AgentBindingQueries,
    @Inject(UNIT_OF_WORK_PORT) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(OUTBOX_WRITER_PORT) private readonly outbox: OutboxWriterPort,
    @Inject(ASSET_CLOCK) private readonly now: () => Date = () => new Date(),
    @Inject(ASSET_ID_GENERATOR)
    private readonly generateId: () => string = randomUUID,
  ) {}

  async execute(assetId: string, actor: AssetActor): Promise<void> {
    await this.unitOfWork.run(async (context) => {
      const current = await this.assets.findById(assetId, context);
      if (!current) throw new AssetReferenceNotFoundError('Asset');
      if (current.lifecycleState === 'RETIRED') return;

      const retired = current.retire();
      const placement = await this.placements.findActiveByAsset(
        assetId,
        context,
      );
      if (placement) {
        throw new AssetRetirementConflictError(
          'Asset must be unmapped before retirement',
        );
      }
      if (await this.bindings.hasActiveBindingForNode(assetId, context)) {
        throw new AssetRetirementConflictError(
          'Asset has an active Agent binding',
        );
      }

      const sequence = await this.assets.save(retired, context);
      const occurredAt = this.now().toISOString();
      const fact: AuditFactV2 = {
        event_id: this.generateId(),
        event_type: AUDIT_FACT_EVENT_TYPE,
        event_version: AUDIT_FACT_EVENT_VERSION_V2,
        producer: 'asset-topology',
        occurred_at: occurredAt,
        resource: { type: 'asset-topology.asset', id: assetId, sequence },
        payload: {
          actor,
          action: 'asset_topology.asset.retired',
          changes: [
            {
              field: 'lifecycle_state',
              before: current.lifecycleState,
              after: retired.lifecycleState,
            },
          ],
        },
        context: actor.context ?? {},
      };
      await this.outbox.append(fact, context);
    });
  }
}

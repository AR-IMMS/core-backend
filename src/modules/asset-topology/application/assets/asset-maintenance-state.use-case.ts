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
import type {
  AssetTopologyCommandActor,
  AssetTopologyMaintenanceCommands,
  RequestAssetMaintenanceStateChange,
} from '../../contracts';
import { AssetReferenceNotFoundError } from './asset-registration.use-case';
import type { AssetStorePort } from './asset-store.port';
import { ASSET_STORE } from './asset-store.token';
import { ASSET_CLOCK, ASSET_ID_GENERATOR } from './asset-runtime.token';

/** Persists Asset-owned maintenance state changes and their Audit Facts. */
@Injectable()
export class ChangeAssetMaintenanceStateUseCase implements AssetTopologyMaintenanceCommands {
  constructor(
    @Inject(ASSET_STORE) private readonly assets: AssetStorePort,
    @Inject(UNIT_OF_WORK_PORT) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(OUTBOX_WRITER_PORT) private readonly outbox: OutboxWriterPort,
    @Inject(ASSET_CLOCK) private readonly now: () => Date = () => new Date(),
    @Inject(ASSET_ID_GENERATOR)
    private readonly generateId: () => string = randomUUID,
  ) {}

  async requestMaintenanceStateChange(
    request: RequestAssetMaintenanceStateChange,
    actor: AssetTopologyCommandActor,
  ): Promise<void> {
    await this.unitOfWork.run(async (context) => {
      const current = await this.assets.findById(request.assetId, context);
      if (!current) throw new AssetReferenceNotFoundError('Asset');

      const updated = current.changeMaintenanceState(request.targetState);
      if (updated === current) return;

      const sequence = await this.assets.save(updated, context);
      const changes: AuditFactV2['payload']['changes'] = [
        {
          field: 'lifecycle_state',
          before: current.lifecycleState,
          after: updated.lifecycleState,
        },
        {
          field: 'maintenance_state_change_source',
          after: request.source.type,
        },
        ...(request.source.type === 'maintenance_activity'
          ? [
              {
                field: 'maintenance_activity_id',
                after: request.source.id,
              },
            ]
          : request.source.ticketId
            ? [
                {
                  field: 'maintenance_ticket_id',
                  after: request.source.ticketId,
                },
              ]
            : []),
      ];
      await this.outbox.append(
        {
          event_id: this.generateId(),
          event_type: AUDIT_FACT_EVENT_TYPE,
          event_version: AUDIT_FACT_EVENT_VERSION_V2,
          producer: 'asset-topology',
          occurred_at: this.now().toISOString(),
          resource: { type: 'asset-topology.asset', id: updated.id, sequence },
          payload: {
            actor: { type: actor.type, id: actor.id },
            action: `asset_topology.asset.maintenance_state_changed.${request.source.type}`,
            changes,
          },
          context: actor.context ?? {},
        },
        context,
      );
    });
  }
}

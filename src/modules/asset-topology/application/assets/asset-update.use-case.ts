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
import { Asset } from '../../domain/asset/asset';
import type { AssetModelReference } from '../../domain/asset/asset';
import type { AssetCatalogStorePort } from './asset-catalog.port';
import type { AssetStorePort } from './asset-store.port';
import type { AssetActor } from './asset-registration.use-case';
import { AssetReferenceNotFoundError } from './asset-registration.use-case';
import { ASSET_CATALOG_STORE, ASSET_STORE } from './asset-store.token';

export interface UpdateAssetInput {
  readonly name?: string;
  readonly modelId?: string | null;
  readonly serialNumber?: string | null;
}

@Injectable()
export class UpdateAssetUseCase {
  constructor(
    @Inject(ASSET_STORE) private readonly assets: AssetStorePort,
    @Inject(ASSET_CATALOG_STORE)
    private readonly catalog: AssetCatalogStorePort,
    @Inject(UNIT_OF_WORK_PORT) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(OUTBOX_WRITER_PORT) private readonly outbox: OutboxWriterPort,
    private readonly now: () => Date = () => new Date(),
    private readonly generateId: () => string = randomUUID,
  ) {}

  execute(
    assetId: string,
    input: UpdateAssetInput,
    actor: AssetActor,
  ): Promise<Asset> {
    return this.unitOfWork.run(async (context) => {
      const current = await this.assets.findById(assetId, context);
      if (!current) throw new AssetReferenceNotFoundError('Asset');
      const modelId =
        input.modelId === undefined
          ? current.assetModelId
          : (input.modelId ?? undefined);
      let model: AssetModelReference | undefined;
      if (modelId) {
        model = (await this.catalog.findModel(modelId, context)) ?? undefined;
        if (!model) throw new AssetReferenceNotFoundError('Asset Model');
      }
      const updated = current.updateDescription({
        name: input.name,
        model,
        serialNumber:
          input.serialNumber === undefined
            ? current.serialNumber
            : (input.serialNumber ?? undefined),
      });
      const changes: AuditFactV2['payload']['changes'][number][] = [];
      if (updated.name !== current.name)
        changes.push({
          field: 'name',
          before: current.name,
          after: updated.name,
        });
      if (updated.assetModelId !== current.assetModelId)
        changes.push({
          field: 'model_id',
          before: current.assetModelId,
          after: updated.assetModelId,
        });
      if (updated.serialNumber !== current.serialNumber)
        changes.push({
          field: 'manufacturer_serial_number',
          before: current.serialNumber,
          after: updated.serialNumber,
        });
      if (changes.length === 0) return current;

      const sequence = await this.assets.save(updated, context);
      const occurredAt = this.now();
      await this.outbox.append(
        {
          event_id: this.generateId(),
          event_type: AUDIT_FACT_EVENT_TYPE,
          event_version: AUDIT_FACT_EVENT_VERSION_V2,
          producer: 'asset-topology',
          occurred_at: occurredAt.toISOString(),
          resource: { type: 'asset-topology.asset', id: updated.id, sequence },
          payload: { actor, action: 'asset_topology.asset.updated', changes },
          context: actor.context ?? {},
        },
        context,
      );
      return updated;
    });
  }
}

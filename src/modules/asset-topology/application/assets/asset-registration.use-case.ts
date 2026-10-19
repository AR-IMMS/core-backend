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
import { ASSET_CATALOG_STORE, ASSET_STORE } from './asset-store.token';

export interface AssetActor {
  readonly type: string;
  readonly id: string;
  readonly context?: {
    readonly request_id?: string;
    readonly trace_id?: string;
  };
}
export interface RegisterAssetInput {
  readonly name: string;
  readonly assetTypeId: string;
  readonly modelId?: string;
  readonly serialNumber?: string;
}
export class AssetReferenceNotFoundError extends Error {
  constructor(resource: 'Asset' | 'Asset Type' | 'Asset Model') {
    super(`${resource} was not found`);
    this.name = 'AssetReferenceNotFoundError';
  }
}

@Injectable()
export class RegisterAssetUseCase {
  constructor(
    @Inject(ASSET_STORE) private readonly assets: AssetStorePort,
    @Inject(ASSET_CATALOG_STORE)
    private readonly catalog: AssetCatalogStorePort,
    @Inject(UNIT_OF_WORK_PORT) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(OUTBOX_WRITER_PORT) private readonly outbox: OutboxWriterPort,
    private readonly now: () => Date = () => new Date(),
    private readonly generateId: () => string = randomUUID,
  ) {}

  execute(input: RegisterAssetInput, actor: AssetActor): Promise<Asset> {
    return this.unitOfWork.run(async (context) => {
      const type = await this.catalog.findType(input.assetTypeId, context);
      if (!type) throw new AssetReferenceNotFoundError('Asset Type');
      let model: AssetModelReference | undefined;
      if (input.modelId) {
        model =
          (await this.catalog.findModel(input.modelId, context)) ?? undefined;
        if (!model) throw new AssetReferenceNotFoundError('Asset Model');
      }
      const asset = Asset.register({
        id: this.generateId(),
        name: input.name,
        type,
        model,
        serialNumber: input.serialNumber,
      });
      const sequence = await this.assets.save(asset, context);
      await this.outbox.append(
        this.auditFact(actor, asset, sequence, [
          { field: 'name', after: asset.name },
          { field: 'asset_type_id', after: asset.assetTypeId },
          { field: 'lifecycle_state', after: asset.lifecycleState },
          ...(asset.assetModelId
            ? [{ field: 'model_id', after: asset.assetModelId }]
            : []),
          ...(asset.serialNumber
            ? [
                {
                  field: 'manufacturer_serial_number',
                  after: asset.serialNumber,
                },
              ]
            : []),
        ]),
        context,
      );
      return asset;
    });
  }

  private auditFact(
    actor: AssetActor,
    asset: Asset,
    sequence: number,
    changes: AuditFactV2['payload']['changes'],
  ): AuditFactV2 {
    return {
      event_id: this.generateId(),
      event_type: AUDIT_FACT_EVENT_TYPE,
      event_version: AUDIT_FACT_EVENT_VERSION_V2,
      producer: 'asset-topology',
      occurred_at: this.now().toISOString(),
      resource: { type: 'asset-topology.asset', id: asset.id, sequence },
      payload: { actor, action: 'asset_topology.asset.created', changes },
      context: actor.context ?? {},
    };
  }
}

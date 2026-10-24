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
  AssetTopologyAssetQueries,
  AssetTopologyRackQueries,
} from '../../contracts';
import {
  ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
  ASSET_TOPOLOGY_RACK_QUERIES_PORT,
} from '../../contracts';
import type { AssetActor } from '../assets/asset-registration.use-case';
import type { AssetStorePort } from '../assets/asset-store.port';
import { ASSET_STORE } from '../assets/asset-store.token';
import type { RackStorePort } from '../racks/rack-store.port';
import { RACK_STORE } from '../racks/rack-store.token';
import { QR_MAPPING_STORE } from './qr-mapping-store.token';
import { ASSET_CLOCK, ASSET_ID_GENERATOR } from '../assets/asset-runtime.token';
import type {
  QrMapping,
  QrMappingStorePort,
  QrTargetType,
} from './qr-mapping-store.port';
import {
  isQrDuplicateKeyError,
  QrMappingConflictError,
} from './qr-mapping.errors';

export class QrMappingTargetNotFoundError extends Error {
  constructor() {
    super('QR mapping target was not found');
    this.name = 'QrMappingTargetNotFoundError';
  }
}
export class QrMappingNotFoundError extends Error {
  constructor() {
    super('Active QR mapping was not found');
    this.name = 'QrMappingNotFoundError';
  }
}
/** Owns QR mapping history; target details are always resolved from current domain queries. */
@Injectable()
export class QrMappingUseCases {
  constructor(
    @Inject(QR_MAPPING_STORE) private readonly mappings: QrMappingStorePort,
    @Inject(ASSET_TOPOLOGY_ASSET_QUERIES_PORT)
    private readonly assets: AssetTopologyAssetQueries,
    @Inject(ASSET_TOPOLOGY_RACK_QUERIES_PORT)
    private readonly racks: AssetTopologyRackQueries,
    @Inject(UNIT_OF_WORK_PORT) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(OUTBOX_WRITER_PORT) private readonly outbox: OutboxWriterPort,
    @Inject(ASSET_CLOCK) private readonly now: () => Date = () => new Date(),
    @Inject(ASSET_ID_GENERATOR)
    private readonly generateValue: () => string = randomUUID,
    @Inject(ASSET_ID_GENERATOR)
    private readonly generateId: () => string = randomUUID,
    @Inject(ASSET_STORE) private readonly assetStore: AssetStorePort,
    @Inject(RACK_STORE) private readonly rackStore: RackStorePort,
  ) {}

  async assign(
    type: QrTargetType,
    targetId: string,
    actor: AssetActor,
  ): Promise<QrMapping> {
    return this.unitOfWork.run(async (context) => {
      const target = await this.readTarget(type, targetId);
      if (!target) throw new QrMappingTargetNotFoundError();
      const previous = await this.mappings.getActiveForTarget(
        type,
        targetId,
        context,
      );
      const mapping: QrMapping = {
        id: this.generateId(),
        value: this.generateValue(),
        targetType: type,
        targetId,
        active: true,
        validFrom: this.now(),
      };
      try {
        await this.mappings.replaceActive(mapping, context);
      } catch (error) {
        if (isQrDuplicateKeyError(error)) throw new QrMappingConflictError();
        throw error;
      }
      await this.appendAudit(
        type,
        targetId,
        actor,
        previous
          ? 'asset_topology.qr_mapping.replaced'
          : 'asset_topology.qr_mapping.assigned',
        [
          { field: 'qr_mapping_source', after: 'manual' },
          {
            field: 'qr_value',
            ...(previous ? { before: previous.value } : {}),
            after: mapping.value,
          },
        ],
        context,
      );
      return mapping;
    });
  }

  async deactivate(
    type: QrTargetType,
    targetId: string,
    actor: AssetActor,
  ): Promise<void> {
    await this.unitOfWork.run(async (context) => {
      const previous = await this.mappings.getActiveForTarget(
        type,
        targetId,
        context,
      );
      if (!previous) throw new QrMappingNotFoundError();
      await this.mappings.deactivateActive(type, targetId, context);
      await this.appendAudit(
        type,
        targetId,
        actor,
        'asset_topology.qr_mapping.deactivated',
        [
          { field: 'qr_mapping_source', after: 'manual' },
          { field: 'qr_value', before: previous.value, after: null },
        ],
        context,
      );
    });
  }

  async resolve(value: string): Promise<{
    readonly target_type: QrTargetType;
    readonly target_id: string;
    readonly target: unknown;
  } | null> {
    const mapping = await this.mappings.findActiveByValue(value);
    if (!mapping) return null;
    const target = await this.readTarget(mapping.targetType, mapping.targetId);
    if (!target) return null;
    return {
      target_type: mapping.targetType,
      target_id: mapping.targetId,
      target,
    };
  }

  getActiveMapping(
    type: QrTargetType,
    targetId: string,
  ): Promise<QrMapping | null> {
    return this.mappings.getActiveForTarget(type, targetId);
  }

  private readTarget(type: QrTargetType, id: string) {
    return type === 'asset'
      ? this.assets.getAsset(id as never)
      : this.racks.getRack(id as never);
  }

  private async appendAudit(
    type: QrTargetType,
    id: string,
    actor: AssetActor,
    action: string,
    changes: AuditFactV2['payload']['changes'],
    context: Parameters<OutboxWriterPort['append']>[1],
  ): Promise<void> {
    const sequence =
      type === 'asset'
        ? await this.assetStore.save(
            (await this.assetStore.findById(id, context))!,
            context,
          )
        : await this.rackStore.saveRack(
            (await this.rackStore.getRack(id, context))!,
            context,
          );
    await this.outbox.append(
      {
        event_id: this.generateId(),
        event_type: AUDIT_FACT_EVENT_TYPE,
        event_version: AUDIT_FACT_EVENT_VERSION_V2,
        producer: 'asset-topology',
        occurred_at: this.now().toISOString(),
        resource: { type: `asset-topology.${type}`, id, sequence },
        payload: { actor, action, changes },
        context: actor.context ?? {},
      },
      context,
    );
  }
}

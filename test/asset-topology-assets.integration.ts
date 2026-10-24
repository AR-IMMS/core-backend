import assert from 'node:assert/strict';
import { createConnection } from 'mongoose';
import { AuditEventConsumer } from '@modules/audit/application/audit-event.consumer';
import type { AuditRecord } from '@modules/audit/domain/audit-record';
import {
  AUDIT_RECORD_MODEL,
  AuditRecordSchema,
} from '@modules/audit/infrastructure/mongodb/audit-record.schema';
import {
  MongoAuditRecordStore,
  type MongoAuditRecordModel,
} from '@modules/audit/infrastructure/mongodb/mongo-audit-record.store';
import { RegisterAssetUseCase } from '@modules/asset-topology/application/assets/asset-registration.use-case';
import { UpdateAssetUseCase } from '@modules/asset-topology/application/assets/asset-update.use-case';
import { ASSET_CATALOG_MIGRATION } from '@modules/asset-topology/infrastructure/mongodb/migrations/asset-catalog.migration';
import { QR_MAPPING_MIGRATION } from '@modules/asset-topology/infrastructure/mongodb/migrations/qr-mapping.migration';
import { MongoQrMappingStore } from '@modules/asset-topology/infrastructure/mongodb/mongo-qr-mapping.store';
import {
  QR_MAPPING_MODEL,
  QrMappingSchema,
} from '@modules/asset-topology/infrastructure/mongodb/qr-mapping.schema';
import { MongoAssetStore } from '@modules/asset-topology/infrastructure/mongodb/mongo-asset.store';
import {
  ASSET_MODEL,
  ASSET_MODEL_MODEL,
  ASSET_TYPE_MODEL,
  AssetModelSchema,
  AssetSchema,
  AssetTypeSchema,
} from '@modules/asset-topology/infrastructure/mongodb/asset.schema';
import { PermissionCatalogPort } from '@modules/iam/application/ports/permission-catalog.port';
import { EventConsumerRegistry } from '@platform/events/application/event-consumer.registry';
import { OutboxRelayService } from '@platform/events/application/outbox-relay.service';
import { MongoOutboxStore } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import { MongoUnitOfWork } from '@platform/events/infrastructure/mongodb/mongo-unit-of-work';
import {
  OUTBOX_ENTRY_MODEL,
  OutboxEntrySchema,
} from '@platform/events/infrastructure/mongodb/outbox.schema';
import type { OutboxWriterPort } from '@platform/events';
import type { MongoOutboxModel } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import { resolveMongoTestConfig } from './mongodb-test-config';

async function main(): Promise<void> {
  const { uri, dbName } = resolveMongoTestConfig();
  const connection = await createConnection(uri, {
    dbName,
    serverSelectionTimeoutMS: 5_000,
  }).asPromise();
  try {
    await connection.dropDatabase();
    await ASSET_CATALOG_MIGRATION.up(connection);
    await QR_MAPPING_MIGRATION.up(connection);
    const assets = connection.model(ASSET_MODEL, AssetSchema);
    const types = connection.model(ASSET_TYPE_MODEL, AssetTypeSchema);
    const models = connection.model(ASSET_MODEL_MODEL, AssetModelSchema);
    const qrMappings = connection.model(QR_MAPPING_MODEL, QrMappingSchema);
    const outboxModel = connection.model(OUTBOX_ENTRY_MODEL, OutboxEntrySchema);
    const auditModel = connection.model<AuditRecord>(
      AUDIT_RECORD_MODEL,
      AuditRecordSchema as never,
    );
    await Promise.all([
      assets.init(),
      types.init(),
      models.init(),
      qrMappings.init(),
      outboxModel.init(),
      auditModel.init(),
    ]);

    const store = new MongoAssetStore(
      assets as never,
      types as never,
      models as never,
    );
    const qrMappingStore = new MongoQrMappingStore(qrMappings as never);
    const unitOfWork = new MongoUnitOfWork(connection);
    const outbox = new MongoOutboxStore(outboxModel as MongoOutboxModel);
    const failingRegistration = new RegisterAssetUseCase(
      store,
      store,
      unitOfWork,
      failingOutbox,
      undefined,
      () => 'rollback-asset',
      qrMappingStore,
    );
    await assert.rejects(
      failingRegistration.execute(
        { name: 'Node', assetTypeId: 'type-node' },
        { type: 'user', id: 'admin-1' },
      ),
      /simulated Outbox failure/,
    );
    assert.equal(await assets.countDocuments({ id: 'rollback-asset' }), 0);
    assert.equal(
      await qrMappings.countDocuments({ targetId: 'rollback-asset' }),
      0,
    );
    assert.equal(await outboxModel.countDocuments({}), 0);

    let generated = 0;
    const registration = new RegisterAssetUseCase(
      store,
      store,
      unitOfWork,
      outbox,
      () => new Date('2026-10-19T00:00:00.000Z'),
      () => `event-${++generated}`,
      qrMappingStore,
    );
    const update = new UpdateAssetUseCase(
      store,
      store,
      unitOfWork,
      outbox,
      () => new Date('2026-10-19T00:01:00.000Z'),
    );
    const actor = { type: 'user', id: 'admin-1' };
    const asset = await registration.execute(
      { name: 'Node', assetTypeId: 'type-node' },
      actor,
    );
    assert.equal(
      await qrMappings.countDocuments({ targetId: asset.id, active: true }),
      1,
    );
    const firstQr = (await qrMappings.collection.findOne({
      targetId: asset.id,
      active: true,
    })) as { id: string; value: string } | null;
    assert.ok(firstQr);
    const replacement = {
      id: 'replacement-mapping',
      value: 'replacement-qr',
      targetType: 'asset' as const,
      targetId: asset.id,
      active: true,
      validFrom: new Date('2026-10-20T00:00:00.000Z'),
    };
    await unitOfWork.run((context) =>
      qrMappingStore.replaceActive(replacement, context),
    );
    const previousQr = await qrMappings.collection.findOne({ id: firstQr.id });
    assert.equal(previousQr?.active, false);
    assert.ok(previousQr?.validTo);
    assert.equal(await qrMappingStore.findActiveByValue(firstQr.value), null);
    await assert.rejects(
      unitOfWork.run((context) =>
        qrMappingStore.replaceActive(
          {
            ...replacement,
            id: 'reused-value',
            value: firstQr.value,
            targetId: 'another-asset',
          },
          context,
        ),
      ),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000,
    );
    await unitOfWork.run((context) =>
      qrMappingStore.deactivateActive('asset', asset.id, context),
    );
    const finalQr = await qrMappings.collection.findOne({ id: replacement.id });
    assert.equal(finalQr?.active, false);
    assert.ok(finalQr?.validTo);
    await update.execute(asset.id, { name: 'Node 01' }, actor);

    const consumer = new AuditEventConsumer(
      new MongoAuditRecordStore(auditModel as MongoAuditRecordModel),
      {
        isKnownPermissionCode: () => false,
      } satisfies PermissionCatalogPort,
    );
    const relay = new OutboxRelayService(
      outbox,
      new EventConsumerRegistry([consumer]),
    );
    assert.deepEqual(await relay.runOnce(), {
      claimed: 1,
      delivered: 1,
      failed: 0,
    });
    assert.deepEqual(await relay.runOnce(), {
      claimed: 1,
      delivered: 1,
      failed: 0,
    });
    const records = await auditModel
      .find({ producer: 'asset-topology' })
      .sort({ occurredAt: 1 })
      .lean()
      .exec();
    assert.deepEqual(
      records.map(({ action, resource }) => [action, resource.id]),
      [
        ['asset_topology.asset.created', asset.id],
        ['asset_topology.asset.updated', asset.id],
      ],
    );
    assert.deepEqual(
      records.map(({ producer, actor: auditActor, occurredAt }) => [
        producer,
        auditActor,
        occurredAt.toISOString(),
      ]),
      [
        [
          'asset-topology',
          { type: 'user', id: 'admin-1' },
          '2026-10-19T00:00:00.000Z',
        ],
        [
          'asset-topology',
          { type: 'user', id: 'admin-1' },
          '2026-10-19T00:01:00.000Z',
        ],
      ],
    );
    const outboxFacts = (await connection
      .collection('platform_event_outbox')
      .find({})
      .toArray()) as unknown as { fact: { resource: { sequence: number } } }[];
    assert.deepEqual(
      outboxFacts.map(({ fact }) => fact.resource.sequence),
      [1, 2],
    );
    process.stdout.write(
      'PASS Asset registration/update Audit delivery and transaction rollback\n',
    );
  } finally {
    await connection.close();
  }
}

const failingOutbox: OutboxWriterPort = {
  append: () => {
    throw new Error('simulated Outbox failure');
  },
};
void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});

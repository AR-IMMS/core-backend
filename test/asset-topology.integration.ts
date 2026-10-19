import assert from 'node:assert/strict';
import { createConnection, type Model } from 'mongoose';

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
import { TopologyUseCases } from '@modules/asset-topology/application/topology/topology-use-cases';
import type { TopologyStorePort } from '@modules/asset-topology/application/topology/topology-store.port';
import { DEFAULT_DATA_CENTER_MIGRATION } from '@modules/asset-topology/infrastructure/mongodb/migrations/default-data-center.migration';
import {
  MongoTopologyStore,
  type MongoTopologyDataCenterModel,
  type MongoTopologyRoomModel,
  type MongoTopologySiteModel,
} from '@modules/asset-topology/infrastructure/mongodb/mongo-topology.store';
import {
  TOPOLOGY_DATA_CENTER_MODEL,
  TOPOLOGY_ROOM_MODEL,
  TOPOLOGY_SITE_MODEL,
  TopologyDataCenterSchema,
  TopologyRoomSchema,
  TopologySiteSchema,
} from '@modules/asset-topology/infrastructure/mongodb/topology.schema';
import { PermissionCatalogPort } from '@modules/iam/application/ports/permission-catalog.port';
import {
  EventConsumerRegistry,
  MongoUnitOfWork,
  MongoOutboxStore,
  OutboxRelayService,
  OUTBOX_ENTRY_MODEL,
  OutboxEntrySchema,
} from '@platform/events';
import type { OutboxWriterPort } from '@platform/events';
import type { MongoOutboxModel } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import type { UnitOfWorkPort } from '@platform/events';
import type { MongoConnection } from '@platform/events/infrastructure/mongodb/mongo-connection.types';
import { resolveMongoTestConfig } from './mongodb-test-config';

async function main(): Promise<void> {
  const { uri, dbName } = resolveMongoTestConfig();
  const connection = await createConnection(uri, {
    dbName,
    serverSelectionTimeoutMS: 5_000,
  }).asPromise();

  try {
    await connection.dropDatabase();
    await DEFAULT_DATA_CENTER_MIGRATION.up(connection);

    const dataCenters = connection.model(
      TOPOLOGY_DATA_CENTER_MODEL,
      TopologyDataCenterSchema,
    );
    const sites = connection.model(TOPOLOGY_SITE_MODEL, TopologySiteSchema);
    const rooms = connection.model(TOPOLOGY_ROOM_MODEL, TopologyRoomSchema);
    const outboxModel = connection.model(OUTBOX_ENTRY_MODEL, OutboxEntrySchema);
    const auditModel = connection.model<AuditRecord>(
      AUDIT_RECORD_MODEL,
      AuditRecordSchema,
    );
    await Promise.all([
      dataCenters.init(),
      sites.init(),
      rooms.init(),
      outboxModel.init(),
      auditModel.init(),
    ]);

    const store = new MongoTopologyStore(
      dataCenters as unknown as MongoTopologyDataCenterModel,
      sites as unknown as MongoTopologySiteModel,
      rooms as unknown as MongoTopologyRoomModel,
    );
    const unitOfWork = new MongoUnitOfWork(
      connection as unknown as MongoConnection,
    );
    const outbox = new MongoOutboxStore(
      outboxModel as unknown as MongoOutboxModel,
    );

    await runCase(
      'topology write and Audit Outbox transaction rollback',
      async () => {
        const failingUseCases = new TopologyUseCases(
          store,
          unitOfWork,
          failingOutbox,
          () => new Date('2026-10-19T00:00:00.000Z'),
          () => 'rollback-site',
        );
        await assert.rejects(
          failingUseCases.createSite(
            { name: 'Rollback Site', dataCenterId: 'dc-default' as never },
            { type: 'user', id: 'admin-1' },
          ),
          /simulated Outbox failure/,
        );
        assert.equal(await sites.countDocuments({ id: 'rollback-site' }), 0);
        assert.equal(await outboxModel.countDocuments({}), 0);
      },
    );

    await runCase(
      'Site and Room Audit delivery through the Audit consumer',
      async () => {
        const topology = new TopologyUseCases(
          store,
          unitOfWork,
          outbox,
          () => new Date('2026-10-19T00:00:00.000Z'),
        );
        const site = await topology.createSite(
          { name: 'Building A', dataCenterId: 'dc-default' as never },
          { type: 'user', id: 'admin-1' },
        );
        const room = await topology.createRoom(
          {
            name: 'Server Room A',
            siteId: site.id,
            widthMm: 10_000,
            depthMm: 8_000,
            gridSnapMm: 100,
          },
          { type: 'user', id: 'admin-1' },
        );
        await topology.updateRoom(
          room.id,
          {
            name: 'Server Room B',
            widthMm: 12_000,
            depthMm: 8_000,
            gridSnapMm: 100,
          },
          { type: 'user', id: 'admin-1' },
        );

        const consumer = new AuditEventConsumer(
          new MongoAuditRecordStore(
            auditModel as unknown as MongoAuditRecordModel,
          ),
          {
            isKnownPermissionCode: (_code: string) => false,
          } satisfies PermissionCatalogPort,
        );
        const relay = new OutboxRelayService(
          outbox,
          new EventConsumerRegistry([consumer]),
        );
        const delivery = await relay.runOnce();
        const auditRecords = await auditModel
          .find({ producer: 'asset-topology' })
          .sort({ occurredAt: 1, eventId: 1 })
          .lean()
          .exec();

        assert.deepEqual(delivery, { claimed: 3, delivered: 3, failed: 0 });
        assert.deepEqual(
          auditRecords.map(({ action, resource }) => [
            action,
            resource.type,
            resource.id,
          ]),
          [
            ['asset_topology.site.created', 'asset-topology.site', site.id],
            ['asset_topology.room.created', 'asset-topology.room', room.id],
            ['asset_topology.room.updated', 'asset-topology.room', room.id],
          ],
        );
        assert.deepEqual(
          auditRecords.map(({ resource }) => resource.sequence),
          [1, 1, 2],
        );
        assert.equal(
          auditRecords.every(({ actor }) => actor.id === 'admin-1'),
          true,
        );
      },
    );
  } finally {
    await connection.close();
  }
}

const failingOutbox: OutboxWriterPort = {
  append: async () => {
    throw new Error('simulated Outbox failure');
  },
};

async function runCase(
  name: string,
  operation: () => Promise<void>,
): Promise<void> {
  await operation();
  process.stdout.write(`PASS ${name}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});

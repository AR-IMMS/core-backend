import assert from 'node:assert/strict';
import { createHash as sha256, randomUUID } from 'node:crypto';
import { createConnection } from 'mongoose';
import { AgentEnrollmentEligibilityUseCase } from '@modules/asset-topology/application/assets/agent-enrollment-eligibility.use-case';
import { GetAssetUseCase } from '@modules/asset-topology/application/assets/asset-query.use-case';
import { RetireAssetUseCase } from '@modules/asset-topology/application/assets/retire-asset.use-case';
import { ASSET_PLACEMENT_MIGRATION } from '@modules/asset-topology/infrastructure/mongodb/migrations/asset-placement.migration';
import {
  AssetSchema,
  ASSET_MODEL,
} from '@modules/asset-topology/infrastructure/mongodb/asset.schema';
import {
  AssetLocationSchema,
  ASSET_TOPOLOGY_ASSET_LOCATION_MODEL,
} from '@modules/asset-topology/infrastructure/mongodb/asset-placement.schema';
import { MongoAssetStore } from '@modules/asset-topology/infrastructure/mongodb/mongo-asset.store';
import { MongoAssetPlacementStore } from '@modules/asset-topology/infrastructure/mongodb/mongo-asset-placement.store';
import { AgentNodeNotEligibleError } from '@modules/agent-management/application/enrollment.port';
import { EnrollAgentUseCase } from '@modules/agent-management/application/enroll-agent.use-case';
import { MongoEnrollmentStore } from '@modules/agent-management/infrastructure/mongodb/mongo-enrollment.store';
import { BOOTSTRAP_TOKEN_INDEXES_MIGRATION } from '@modules/agent-management/infrastructure/mongodb/migrations/bootstrap-token-indexes.migration';
import { ENROLLMENT_INDEXES_MIGRATION } from '@modules/agent-management/infrastructure/mongodb/migrations/enrollment-indexes.migration';
import { MongoOutboxStore } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import type { MongoOutboxModel } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import { MongoUnitOfWork } from '@platform/events/infrastructure/mongodb/mongo-unit-of-work';
import {
  OUTBOX_ENTRY_MODEL,
  OutboxEntrySchema,
} from '@platform/events/infrastructure/mongodb/outbox.schema';
import { resolveMongoTestConfig } from './mongodb-test-config';

const assetId = 'asset-retirement-integration';
const token = 'arimms_bt_asset-retirement-integration';
const actor = { type: 'user', id: 'admin-1' };

async function main(): Promise<void> {
  const { uri, dbName } = resolveMongoTestConfig();
  const connection = await createConnection(uri, {
    dbName,
    serverSelectionTimeoutMS: 5_000,
  }).asPromise();

  try {
    const database = connection.db;
    if (!database)
      throw new Error('MongoDB connection has no selected database');
    const db = database;
    const assets = connection.model(ASSET_MODEL, AssetSchema);
    const locations = connection.model(
      ASSET_TOPOLOGY_ASSET_LOCATION_MODEL,
      AssetLocationSchema,
    );
    const outboxModel = connection.model(OUTBOX_ENTRY_MODEL, OutboxEntrySchema);
    await Promise.all([assets.init(), locations.init(), outboxModel.init()]);
    await ASSET_PLACEMENT_MIGRATION.up(connection);
    await BOOTSTRAP_TOKEN_INDEXES_MIGRATION.up(connection);
    await ENROLLMENT_INDEXES_MIGRATION.up(connection);

    const assetStore = new MongoAssetStore(
      assets as never,
      {} as never,
      {} as never,
    );
    const placementStore = new MongoAssetPlacementStore(locations as never);
    const enrollmentStore = new MongoEnrollmentStore(connection);
    const outbox = new MongoOutboxStore(
      outboxModel as unknown as MongoOutboxModel,
    );
    const unitOfWork = new MongoUnitOfWork(connection);
    const getAsset = new GetAssetUseCase(assetStore, placementStore);
    const enrollmentEligibility = new AgentEnrollmentEligibilityUseCase(
      assetStore,
      placementStore,
    );
    const nodeEligibility = {
      getEligibility: (id: string) =>
        getAsset.getAgentEnrollmentNodeEligibility(id as never),
      serializeEnrollmentEligibility: (id: string, context: never) =>
        enrollmentEligibility.serializeAgentEnrollment(id as never, context),
    };

    async function reset(placed: boolean): Promise<void> {
      await connection.dropDatabase();
      await ASSET_PLACEMENT_MIGRATION.up(connection);
      await BOOTSTRAP_TOKEN_INDEXES_MIGRATION.up(connection);
      await ENROLLMENT_INDEXES_MIGRATION.up(connection);
      await assets.create({
        id: assetId,
        name: 'Node 01',
        assetTypeId: 'type-node',
        lifecycleState: 'ACTIVE',
        auditSequence: 0,
      });
      if (placed) {
        await locations.collection.insertOne({
          id: 'location-1',
          assetId,
          rackId: 'rack-1',
          uPosition: 1,
          validFrom: new Date(),
        });
      }
      await db.collection('agent_management_bootstrap_tokens').insertOne({
        tokenId: 'bt-1',
        nodeId: assetId,
        tokenHash: createHash(token),
        status: 'active',
        expiresAt: new Date(Date.now() + 60_000),
      });
    }

    const retire = () =>
      new RetireAssetUseCase(
        assetStore,
        placementStore,
        {
          hasActiveBindingForNode: (nodeId, context) =>
            enrollmentStore.hasActiveBinding(nodeId, context),
        },
        unitOfWork,
        outbox,
      ).execute(assetId, actor);
    const enroll = () =>
      new EnrollAgentUseCase(
        enrollmentStore,
        nodeEligibility,
        unitOfWork,
        outbox,
        'https://core.example.test/api/v1/agent-control',
        () => new Date(),
        () => Buffer.from('01234567890123456789012345678901'),
        () => randomUUID(),
      ).execute({
        bootstrapToken: token,
        attemptId: `attempt-${randomUUID()}`,
        installation: { id: `installation-${randomUUID()}` },
        agent: { version: '0.1.0' },
        environment: { os: 'linux', architecture: 'amd64' },
      });

    await reset(true);
    const assignedRace = await Promise.allSettled([enroll(), retire()]);
    assert.equal(
      assignedRace.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      await db
        .collection('asset_topology_assets')
        .countDocuments({ id: assetId, lifecycleState: 'RETIRED' }),
      0,
    );
    assert.equal(
      await db
        .collection('agent_management_bindings')
        .countDocuments({ nodeId: assetId, status: 'active' }),
      1,
    );

    await reset(false);
    const unassignedRace = await Promise.allSettled([enroll(), retire()]);
    assert.equal(
      unassignedRace.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.ok(
      unassignedRace.some(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof AgentNodeNotEligibleError,
      ),
    );
    assert.equal(
      await db
        .collection('asset_topology_assets')
        .countDocuments({ id: assetId, lifecycleState: 'RETIRED' }),
      1,
    );
    assert.equal(
      await db
        .collection('agent_management_bindings')
        .countDocuments({ nodeId: assetId, status: 'active' }),
      0,
    );

    await reset(false);
    const failingOutbox = {
      append: () => Promise.reject(new Error('outbox unavailable')),
    };
    await assert.rejects(
      new RetireAssetUseCase(
        assetStore,
        placementStore,
        {
          hasActiveBindingForNode: (nodeId, context) =>
            enrollmentStore.hasActiveBinding(nodeId, context),
        },
        unitOfWork,
        failingOutbox as never,
      ).execute(assetId, actor),
      /outbox unavailable/,
    );
    assert.equal(
      await db
        .collection('asset_topology_assets')
        .countDocuments({ id: assetId, lifecycleState: 'ACTIVE' }),
      1,
    );
    assert.equal(
      await db.collection('platform_event_outbox').countDocuments(),
      0,
    );
  } finally {
    await connection.close();
  }
}

function createHash(value: string): string {
  return sha256('sha256').update(value).digest('hex');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

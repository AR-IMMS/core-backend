import assert from 'node:assert/strict';
import { createConnection } from 'mongoose';
import { RetireAssetUseCase } from '@modules/asset-topology/application/assets/retire-asset.use-case';
import { AssetRetirementConflictError } from '@modules/asset-topology/application/assets/asset-retirement.errors';
import { NodeLifecycleOrchestrator } from '@modules/asset-topology/application/lifecycle/node-lifecycle-orchestrator';
import { NodeLifecyclePendingError } from '@modules/asset-topology/application/lifecycle/node-lifecycle-orchestrator';
import { MongoNodeLifecycleOperationStore } from '@modules/asset-topology/infrastructure/mongodb/mongo-node-lifecycle-operation.store';
import { NODE_LIFECYCLE_OPERATIONS_MIGRATION } from '@modules/asset-topology/infrastructure/mongodb/migrations/node-lifecycle-operations.migration';
import { ASSET_PLACEMENT_MIGRATION } from '@modules/asset-topology/infrastructure/mongodb/migrations/asset-placement.migration';
import {
  AssetSchema,
  ASSET_MODEL,
} from '@modules/asset-topology/infrastructure/mongodb/asset.schema';
import { MongoAssetStore } from '@modules/asset-topology/infrastructure/mongodb/mongo-asset.store';
import { MongoAssetPlacementStore } from '@modules/asset-topology/infrastructure/mongodb/mongo-asset-placement.store';
import {
  AssetLocationSchema,
  ASSET_TOPOLOGY_ASSET_LOCATION_MODEL,
} from '@modules/asset-topology/infrastructure/mongodb/asset-placement.schema';
import { MongoFleetBindingProjectionStore } from '@modules/agent-management/infrastructure/mongodb/mongo-fleet-binding-projection.store';
import { FLEET_BINDING_PROJECTION_MIGRATION } from '@modules/agent-management/infrastructure/mongodb/migrations/fleet-binding-projection.migration';
import type { AgentNodeLifecycleCoordination } from '@modules/agent-management/contracts/agent-node-lifecycle.contract';
import { MongoOutboxStore } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import type { MongoOutboxModel } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import { MongoUnitOfWork } from '@platform/events/infrastructure/mongodb/mongo-unit-of-work';
import {
  OUTBOX_ENTRY_MODEL,
  OutboxEntrySchema,
} from '@platform/events/infrastructure/mongodb/outbox.schema';
import { resolveMongoTestConfig } from './mongodb-test-config';

const assetId = 'asset-retirement-integration';
const actor = { type: 'user', id: 'admin-1' } as const;

async function main(): Promise<void> {
  const { uri, dbName } = resolveMongoTestConfig();
  const connection = await createConnection(uri, {
    dbName,
    serverSelectionTimeoutMS: 5_000,
  }).asPromise();

  try {
    if (!connection.db)
      throw new Error('MongoDB connection has no selected database');
    const assets = connection.model(ASSET_MODEL, AssetSchema);
    const locations = connection.model(
      ASSET_TOPOLOGY_ASSET_LOCATION_MODEL,
      AssetLocationSchema,
    );
    const outboxModel = connection.model(OUTBOX_ENTRY_MODEL, OutboxEntrySchema);
    const assetStore = new MongoAssetStore(
      assets as never,
      {} as never,
      {} as never,
    );
    const placementStore = new MongoAssetPlacementStore(locations as never);
    const fleetBindings = new MongoFleetBindingProjectionStore(connection);
    const unitOfWork = new MongoUnitOfWork(connection);
    const outbox = new MongoOutboxStore(
      outboxModel as unknown as MongoOutboxModel,
    );
    const operationStore = new MongoNodeLifecycleOperationStore(connection);
    const gate: AgentNodeLifecycleCoordination = {
      closeEnrollmentGate: ({
        nodeId,
        operationId,
      }: {
        nodeId: string;
        operationId: string;
      }) =>
        Promise.resolve({
          nodeId,
          operationId,
          version: 1,
          previousState: 'OPEN' as const,
          activeBinding: null,
        }),
      completeEnrollmentGate: () => Promise.resolve(),
    };
    const lifecycle = new NodeLifecycleOrchestrator(
      operationStore,
      gate,
      unitOfWork,
    );
    const reset = async (): Promise<void> => {
      await connection.dropDatabase();
      await Promise.all([assets.init(), locations.init(), outboxModel.init()]);
      await ASSET_PLACEMENT_MIGRATION.up(connection);
      await NODE_LIFECYCLE_OPERATIONS_MIGRATION.up(connection);
      await FLEET_BINDING_PROJECTION_MIGRATION.up(connection);
      await assets.create({
        id: assetId,
        name: 'Node 01',
        assetTypeId: 'type-node',
        lifecycleState: 'ACTIVE',
        auditSequence: 0,
      });
    };

    await Promise.all([assets.init(), locations.init(), outboxModel.init()]);
    await reset();
    const retire = () =>
      new RetireAssetUseCase(
        assetStore,
        placementStore,
        {
          hasActiveBindingForNode: (nodeId, context) =>
            fleetBindings.hasActiveForNode(nodeId, context),
        },
        outbox,
        undefined,
        undefined,
        lifecycle,
      ).execute(assetId, actor);

    await connection.db
      .collection('agent_management_fleet_bindings')
      .insertOne({
        bindingId: 'fleet:invitation-1',
        invitationId: 'invitation-1',
        installationId: 'installation-1',
        nodeId: assetId,
        status: 'active',
        source: 'fleet',
        createdAt: new Date(),
      });
    await assert.rejects(retire(), AssetRetirementConflictError);
    assert.equal(
      await assets.countDocuments({ id: assetId, lifecycleState: 'ACTIVE' }),
      1,
    );

    await reset();
    await assert.rejects(
      new RetireAssetUseCase(
        assetStore,
        placementStore,
        {
          hasActiveBindingForNode: (nodeId, context) =>
            fleetBindings.hasActiveForNode(nodeId, context),
        },
        {
          append: () => Promise.reject(new Error('outbox unavailable')),
        } as never,
        undefined,
        undefined,
        lifecycle,
      ).execute(assetId, actor),
      NodeLifecyclePendingError,
    );
    assert.equal(
      await assets.countDocuments({ id: assetId, lifecycleState: 'ACTIVE' }),
      1,
    );
  } finally {
    await connection.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

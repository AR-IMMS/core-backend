import assert from 'node:assert/strict';
import { createConnection } from 'mongoose';
import { AssetPlacementManagementUseCases } from '@modules/asset-topology/application/placements/asset-placement-management.use-case';
import { MongoAssetPlacementStore } from '@modules/asset-topology/infrastructure/mongodb/mongo-asset-placement.store';
import { ASSET_PLACEMENT_MIGRATION } from '@modules/asset-topology/infrastructure/mongodb/migrations/asset-placement.migration';
import { ASSET_CATALOG_MIGRATION } from '@modules/asset-topology/infrastructure/mongodb/migrations/asset-catalog.migration';
import { RACK_MANAGEMENT_MIGRATION } from '@modules/asset-topology/infrastructure/mongodb/migrations/rack-management.migration';
import { MongoAssetStore } from '@modules/asset-topology/infrastructure/mongodb/mongo-asset.store';
import { MongoRackStore } from '@modules/asset-topology/infrastructure/mongodb/mongo-rack.store';
import {
  ASSET_MODEL,
  ASSET_MODEL_MODEL,
  ASSET_TYPE_MODEL,
  AssetModelSchema,
  AssetSchema,
  AssetTypeSchema,
} from '@modules/asset-topology/infrastructure/mongodb/asset.schema';
import {
  ASSET_TOPOLOGY_ASSET_LOCATION_MODEL,
  AssetLocationSchema,
} from '@modules/asset-topology/infrastructure/mongodb/asset-placement.schema';
import {
  TOPOLOGY_RACK_MODEL,
  TopologyRackSchema,
} from '@modules/asset-topology/infrastructure/mongodb/topology.schema';
import { MongoOutboxStore } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import type { MongoOutboxModel } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import { MongoUnitOfWork } from '@platform/events/infrastructure/mongodb/mongo-unit-of-work';
import {
  OUTBOX_ENTRY_MODEL,
  OutboxEntrySchema,
} from '@platform/events/infrastructure/mongodb/outbox.schema';
import type { OutboxWriterPort } from '@platform/events';
import { resolveMongoTestConfig } from './mongodb-test-config';

async function main(): Promise<void> {
  const { uri, dbName } = resolveMongoTestConfig();
  const connection = await createConnection(uri, {
    dbName,
    serverSelectionTimeoutMS: 5_000,
  }).asPromise();

  try {
    await connection.dropDatabase();
    await Promise.all([
      ASSET_CATALOG_MIGRATION.up(connection),
      RACK_MANAGEMENT_MIGRATION.up(connection),
      ASSET_PLACEMENT_MIGRATION.up(connection),
    ]);

    const assetsModel = connection.model(ASSET_MODEL, AssetSchema);
    const typesModel = connection.model(ASSET_TYPE_MODEL, AssetTypeSchema);
    const modelsModel = connection.model(ASSET_MODEL_MODEL, AssetModelSchema);
    const racksModel = connection.model(
      TOPOLOGY_RACK_MODEL,
      TopologyRackSchema,
    );
    const locationsModel = connection.model(
      ASSET_TOPOLOGY_ASSET_LOCATION_MODEL,
      AssetLocationSchema,
    );
    const outboxModel = connection.model(OUTBOX_ENTRY_MODEL, OutboxEntrySchema);
    await Promise.all([
      assetsModel.init(),
      typesModel.init(),
      modelsModel.init(),
      racksModel.init(),
      locationsModel.init(),
      outboxModel.init(),
    ]);

    const assetStore = new MongoAssetStore(
      assetsModel as never,
      typesModel as never,
      modelsModel as never,
    );
    const rackStore = new MongoRackStore(racksModel as never, {} as never);
    const placementStore = new MongoAssetPlacementStore(
      locationsModel as never,
    );
    const unitOfWork = new MongoUnitOfWork(connection);
    const outbox = new MongoOutboxStore(outboxModel as MongoOutboxModel);
    let generatedId = 0;
    let clockTick = 0;
    const createUseCases = (writer: OutboxWriterPort = outbox) =>
      new AssetPlacementManagementUseCases(
        assetStore,
        rackStore,
        placementStore,
        unitOfWork,
        writer,
        () => new Date(Date.UTC(2026, 9, 20, 0, 0, 0, clockTick++)),
        () => `placement-${++generatedId}`,
      );

    await assetsModel.create([
      { id: 'asset-a', name: 'Node A', assetTypeId: 'type-node' },
      { id: 'asset-b', name: 'Node B', assetTypeId: 'type-node' },
      { id: 'asset-c', name: 'Node C', assetTypeId: 'type-node' },
    ]);
    await racksModel.create([
      { id: 'rack-a', uCapacity: 42 },
      { id: 'rack-b', uCapacity: 42 },
      { id: 'rack-c', uCapacity: 42 },
    ]);

    const actor = { type: 'user', id: 'admin-1' };
    const rollback = createUseCases({
      append: () => {
        throw new Error('simulated Audit Outbox failure');
      },
    });
    await assert.rejects(
      rollback.place('asset-c', 'rack-c', 1, actor),
      /simulated Audit Outbox failure/,
    );
    assert.equal(
      await locationsModel.countDocuments({ assetId: 'asset-c' }),
      0,
    );

    const placements = createUseCases();
    const competing = await Promise.allSettled([
      placements.place('asset-a', 'rack-a', 1, actor),
      placements.place('asset-b', 'rack-a', 1, actor),
    ]);
    assert.equal(
      competing.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      competing.filter((result) => result.status === 'rejected').length,
      1,
    );
    assert.equal(
      await locationsModel.countDocuments({
        rackId: 'rack-a',
        uPosition: 1,
        validTo: { $exists: false },
      }),
      1,
    );

    const sameAssetRace = await Promise.allSettled([
      placements.place('asset-c', 'rack-a', 2, actor),
      placements.place('asset-c', 'rack-c', 3, actor),
    ]);
    assert.equal(
      sameAssetRace.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      sameAssetRace.filter((result) => result.status === 'rejected').length,
      1,
    );
    assert.equal(
      await locationsModel.countDocuments({
        assetId: 'asset-c',
        validTo: { $exists: false },
      }),
      1,
    );

    const placedAsset = competing.find(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof placements.place>>
      > => result.status === 'fulfilled',
    )!.value.assetId;
    await placements.move(placedAsset, 'rack-b', 2, actor);
    const historyAfterMove =
      await placementStore.listHistoryByAsset(placedAsset);
    assert.equal(historyAfterMove.length, 2);
    assert.equal(historyAfterMove[0].isActive, false);
    assert.equal(
      historyAfterMove[0].validTo?.toISOString(),
      historyAfterMove[1].validFrom.toISOString(),
    );
    assert.equal(historyAfterMove[1].isActive, true);

    await placements.unmap(placedAsset, actor);
    const finalHistory = await placementStore.listHistoryByAsset(placedAsset);
    assert.equal(finalHistory.length, 2);
    assert.equal(finalHistory[1].isActive, false);
    assert.equal(
      await locationsModel.countDocuments({
        rackId: 'rack-b',
        uPosition: 2,
        validTo: { $exists: false },
      }),
      0,
    );
    assert.ok((await outboxModel.countDocuments({} as never)) >= 4);

    process.stdout.write(
      'PASS Asset placement atomicity, concurrent Rack-U uniqueness, move/unmap history, and Audit Outbox rollback\n',
    );
  } finally {
    await connection.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});

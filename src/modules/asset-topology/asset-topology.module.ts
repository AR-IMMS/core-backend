import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TopologyUseCases } from './application/topology/topology-use-cases';
import { TOPOLOGY_STORE } from './application/topology/topology-store.token';
import { MongoTopologyStore } from './infrastructure/mongodb/mongo-topology.store';
import {
  TOPOLOGY_DATA_CENTER_MODEL,
  TOPOLOGY_ROOM_MODEL,
  TOPOLOGY_SITE_MODEL,
  TopologyDataCenterSchema,
  TopologyRoomSchema,
  TopologySiteSchema,
} from './infrastructure/mongodb/topology.schema';
import { TopologyController } from './presentation/topology.controller';
import {
  ASSET_CATALOG_STORE,
  ASSET_STORE,
} from './application/assets/asset-store.token';
import { MongoAssetStore } from './infrastructure/mongodb/mongo-asset.store';
import {
  ASSET_MODEL,
  ASSET_MODEL_MODEL,
  ASSET_TYPE_MODEL,
  AssetModelSchema,
  AssetSchema,
  AssetTypeSchema,
} from './infrastructure/mongodb/asset.schema';
import { RegisterAssetUseCase } from './application/assets/asset-registration.use-case';
import { UpdateAssetUseCase } from './application/assets/asset-update.use-case';
import {
  GetAssetUseCase,
  ListAssetsUseCase,
} from './application/assets/asset-query.use-case';
import { ASSET_TOPOLOGY_ASSET_QUERIES_PORT } from './contracts';
import { AssetReadController } from './presentation/assets/asset-read.controller';
import { AssetWriteController } from './presentation/assets/asset-write.controller';
import { randomUUID } from 'node:crypto';
import {
  ASSET_CLOCK,
  ASSET_ID_GENERATOR,
} from './application/assets/asset-runtime.token';

/** Asset & Topology's Dashboard API and owned persistence adapters. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TOPOLOGY_DATA_CENTER_MODEL, schema: TopologyDataCenterSchema },
      { name: TOPOLOGY_SITE_MODEL, schema: TopologySiteSchema },
      { name: TOPOLOGY_ROOM_MODEL, schema: TopologyRoomSchema },
      { name: ASSET_TYPE_MODEL, schema: AssetTypeSchema },
      { name: ASSET_MODEL_MODEL, schema: AssetModelSchema },
      { name: ASSET_MODEL, schema: AssetSchema },
    ]),
  ],
  controllers: [TopologyController, AssetReadController, AssetWriteController],
  providers: [
    MongoTopologyStore,
    { provide: TOPOLOGY_STORE, useExisting: MongoTopologyStore },
    TopologyUseCases,
    MongoAssetStore,
    { provide: ASSET_STORE, useExisting: MongoAssetStore },
    { provide: ASSET_CATALOG_STORE, useExisting: MongoAssetStore },
    { provide: ASSET_CLOCK, useValue: () => new Date() },
    { provide: ASSET_ID_GENERATOR, useValue: randomUUID },
    RegisterAssetUseCase,
    UpdateAssetUseCase,
    GetAssetUseCase,
    {
      provide: ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
      useExisting: GetAssetUseCase,
    },
    ListAssetsUseCase,
  ],
})
export class AssetTopologyModule {}

// The focused Asset query is available independently. The broad consumer
// contract remains unbound until Rack and Room-map query providers are ready.

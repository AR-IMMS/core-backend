import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TopologyUseCases } from './application/topology/topology-use-cases';
import { TOPOLOGY_STORE } from './application/topology/topology-store.token';
import { MongoTopologyStore } from './infrastructure/mongodb/mongo-topology.store';
import {
  TOPOLOGY_DATA_CENTER_MODEL,
  TOPOLOGY_ROOM_MODEL,
  TOPOLOGY_SITE_MODEL,
  TOPOLOGY_RACK_MODEL,
  TOPOLOGY_RACK_LOCATION_MODEL,
  TopologyDataCenterSchema,
  TopologyRoomSchema,
  TopologySiteSchema,
  TopologyRackSchema,
  TopologyRackLocationSchema,
} from './infrastructure/mongodb/topology.schema';
import { TopologyController } from './presentation/topology.controller';
import { RackController } from './presentation/racks/rack.controller';
import { RackManagementUseCases } from './application/racks/rack-management.use-case';
import { RackQueryUseCase } from './application/racks/rack-query.use-case';
import { RACK_STORE } from './application/racks/rack-store.token';
import { MongoRackStore } from './infrastructure/mongodb/mongo-rack.store';
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
import {
  ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
  ASSET_TOPOLOGY_MAINTENANCE_COMMANDS_PORT,
  ASSET_TOPOLOGY_RACK_QUERIES_PORT,
} from './contracts';
import { ChangeAssetMaintenanceStateUseCase } from './application/assets/asset-maintenance-state.use-case';
import { AssetReadController } from './presentation/assets/asset-read.controller';
import { AssetWriteController } from './presentation/assets/asset-write.controller';
import { AssetPlacementController } from './presentation/assets/asset-placement.controller';
import {
  ASSET_TOPOLOGY_ASSET_LOCATION_MODEL,
  AssetLocationSchema,
} from './infrastructure/mongodb/asset-placement.schema';
import { ASSET_PLACEMENT_STORE } from './application/placements/asset-placement-store.token';
import { MongoAssetPlacementStore } from './infrastructure/mongodb/mongo-asset-placement.store';
import { AssetPlacementManagementUseCases } from './application/placements/asset-placement-management.use-case';
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
      { name: TOPOLOGY_RACK_MODEL, schema: TopologyRackSchema },
      {
        name: TOPOLOGY_RACK_LOCATION_MODEL,
        schema: TopologyRackLocationSchema,
      },
      { name: ASSET_TYPE_MODEL, schema: AssetTypeSchema },
      { name: ASSET_MODEL_MODEL, schema: AssetModelSchema },
      { name: ASSET_MODEL, schema: AssetSchema },
      {
        name: ASSET_TOPOLOGY_ASSET_LOCATION_MODEL,
        schema: AssetLocationSchema,
      },
    ]),
  ],
  controllers: [
    TopologyController,
    RackController,
    AssetReadController,
    AssetWriteController,
    AssetPlacementController,
  ],
  providers: [
    MongoTopologyStore,
    { provide: TOPOLOGY_STORE, useExisting: MongoTopologyStore },
    TopologyUseCases,
    MongoRackStore,
    { provide: RACK_STORE, useExisting: MongoRackStore },
    RackManagementUseCases,
    RackQueryUseCase,
    MongoAssetStore,
    MongoAssetPlacementStore,
    { provide: ASSET_PLACEMENT_STORE, useExisting: MongoAssetPlacementStore },
    { provide: ASSET_STORE, useExisting: MongoAssetStore },
    { provide: ASSET_CATALOG_STORE, useExisting: MongoAssetStore },
    { provide: ASSET_CLOCK, useValue: () => new Date() },
    { provide: ASSET_ID_GENERATOR, useValue: randomUUID },
    RegisterAssetUseCase,
    UpdateAssetUseCase,
    ChangeAssetMaintenanceStateUseCase,
    AssetPlacementManagementUseCases,
    GetAssetUseCase,
    {
      provide: ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
      useExisting: GetAssetUseCase,
    },
    {
      provide: ASSET_TOPOLOGY_MAINTENANCE_COMMANDS_PORT,
      useExisting: ChangeAssetMaintenanceStateUseCase,
    },
    {
      provide: ASSET_TOPOLOGY_RACK_QUERIES_PORT,
      useExisting: RackQueryUseCase,
    },
    ListAssetsUseCase,
  ],
  exports: [ASSET_TOPOLOGY_MAINTENANCE_COMMANDS_PORT],
})
export class AssetTopologyModule {}

// Asset and Rack/Room-map query ports are available independently. The broad
// consumer contract remains unbound until all methods are implemented.

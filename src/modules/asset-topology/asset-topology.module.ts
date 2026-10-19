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

/** Asset & Topology's Dashboard API and owned persistence adapters. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TOPOLOGY_DATA_CENTER_MODEL, schema: TopologyDataCenterSchema },
      { name: TOPOLOGY_SITE_MODEL, schema: TopologySiteSchema },
      { name: TOPOLOGY_ROOM_MODEL, schema: TopologyRoomSchema },
    ]),
  ],
  controllers: [TopologyController],
  providers: [
    MongoTopologyStore,
    { provide: TOPOLOGY_STORE, useExisting: MongoTopologyStore },
    TopologyUseCases,
  ],
})
export class AssetTopologyModule {}

// AssetTopologyConsumerContract intentionally has no provider yet. Register a
// complete provider only after the Asset and Rack query implementations exist;
// Dashboard REST/OpenAPI remains a separate presentation contract.

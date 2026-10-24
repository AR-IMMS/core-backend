import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { OUTBOX_WRITER_PORT, UNIT_OF_WORK_PORT } from '@platform/events';
import { MongoTopologyStore } from '.././infrastructure/mongodb/mongo-topology.store';
import { TopologyController } from '.././presentation/topology.controller';
import { TopologyUseCases } from '.././application/topology/topology-use-cases';
import { TOPOLOGY_STORE } from '.././application/topology/topology-store.token';
import { ASSET_TOPOLOGY_CONSUMER_PORT } from '.././contracts';
import { AssetTopologyModule } from '.././asset-topology.module';
import { GetAssetUseCase } from '.././application/assets/asset-query.use-case';
import { AssetReadController } from '.././presentation/assets/asset-read.controller';
import { AssetWriteController } from '.././presentation/assets/asset-write.controller';
import { ASSET_TOPOLOGY_ASSET_QUERIES_PORT } from '.././contracts';
import { ASSET_TOPOLOGY_RACK_QUERIES_PORT } from '.././contracts';
import { ASSET_TOPOLOGY_MAINTENANCE_COMMANDS_PORT } from '.././contracts';
import { RackController } from '.././presentation/racks/rack.controller';
import { RackQueryUseCase } from '.././application/racks/rack-query.use-case';
import { ChangeAssetMaintenanceStateUseCase } from '.././application/assets/asset-maintenance-state.use-case';
import { RACK_STORE } from '.././application/racks/rack-store.token';

describe('AssetTopologyModule', () => {
  it('can resolve TopologyUseCases through Nest dependency injection', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TopologyUseCases,
        { provide: TOPOLOGY_STORE, useValue: {} },
        { provide: UNIT_OF_WORK_PORT, useValue: {} },
        { provide: OUTBOX_WRITER_PORT, useValue: {} },
        { provide: RACK_STORE, useValue: {} },
      ],
    }).compile();

    expect(moduleRef.get(TopologyUseCases)).toBeInstanceOf(TopologyUseCases);
    await moduleRef.close();
  });

  it('composes Dashboard topology routes and Asset & Topology-owned persistence', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      AssetTopologyModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AssetTopologyModule,
    ) as unknown[];

    expect(controllers).toContain(TopologyController);
    expect(controllers).toContain(RackController);
    expect(controllers).toContain(AssetReadController);
    expect(controllers).toContain(AssetWriteController);
    expect(providers).toContain(MongoTopologyStore);
    expect(providers).toContain(TopologyUseCases);
    expect(providers).toContainEqual({
      provide: TOPOLOGY_STORE,
      useExisting: MongoTopologyStore,
    });
  });

  it('provides the Asset consumer query independently of the broad contract', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AssetTopologyModule,
    ) as unknown[];
    expect(providers).toContain(GetAssetUseCase);
    expect(providers).toContain(RackQueryUseCase);
    expect(providers).toContainEqual({
      provide: ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
      useExisting: GetAssetUseCase,
    });
    expect(providers).toContainEqual({
      provide: ASSET_TOPOLOGY_RACK_QUERIES_PORT,
      useExisting: RackQueryUseCase,
    });
  });

  it('does not register a partial backend consumer contract provider', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AssetTopologyModule,
    ) as unknown[];
    expect(
      providers.some(
        (provider) =>
          typeof provider === 'object' &&
          provider !== null &&
          'provide' in provider &&
          provider.provide === ASSET_TOPOLOGY_CONSUMER_PORT,
      ),
    ).toBe(false);
  });

  it('exports the Asset maintenance command independently of the broad query contract', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AssetTopologyModule,
    ) as unknown[];
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      AssetTopologyModule,
    ) as unknown[];

    expect(providers).toContain(ChangeAssetMaintenanceStateUseCase);
    expect(providers).toContainEqual({
      provide: ASSET_TOPOLOGY_MAINTENANCE_COMMANDS_PORT,
      useExisting: ChangeAssetMaintenanceStateUseCase,
    });
    expect(exports).toContain(ASSET_TOPOLOGY_MAINTENANCE_COMMANDS_PORT);
  });
});

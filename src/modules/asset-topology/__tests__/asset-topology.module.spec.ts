import { MODULE_METADATA } from '@nestjs/common/constants';
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

describe('AssetTopologyModule', () => {
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
    expect(providers).toContainEqual({
      provide: ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
      useExisting: GetAssetUseCase,
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
});

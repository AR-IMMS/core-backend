import { Module } from '@nestjs/common';
import { OUTBOX_WRITER_PORT, UNIT_OF_WORK_PORT } from '@platform/events';
import { AssetTopologyModule } from '@modules/asset-topology/asset-topology.module';
import { ASSET_TOPOLOGY_ASSET_QUERIES_PORT } from '@modules/asset-topology/contracts';
import type {
  AssetTopologyAssetQueries,
  AssetId,
} from '@modules/asset-topology/contracts';
import {
  BOOTSTRAP_TOKEN_STORE,
  NODE_ELIGIBILITY_PORT,
} from './application/bootstrap-token.port';
import type {
  BootstrapTokenStorePort,
  NodeEligibilityPort,
} from './application/bootstrap-token.port';
import { IssueBootstrapTokenUseCase } from './application/issue-bootstrap-token.use-case';
import { MongoBootstrapTokenStore } from './infrastructure/mongodb/mongo-bootstrap-token.store';
import { BootstrapTokenController } from './presentation/bootstrap-token.controller';

@Module({
  imports: [AssetTopologyModule],
  controllers: [BootstrapTokenController],
  providers: [
    MongoBootstrapTokenStore,
    { provide: BOOTSTRAP_TOKEN_STORE, useExisting: MongoBootstrapTokenStore },
    {
      provide: NODE_ELIGIBILITY_PORT,
      useFactory: (assets: AssetTopologyAssetQueries) => ({
        getEligibility: (nodeId: string) =>
          assets.getAgentEnrollmentNodeEligibility(nodeId as AssetId),
      }),
      inject: [ASSET_TOPOLOGY_ASSET_QUERIES_PORT],
    },
    {
      provide: IssueBootstrapTokenUseCase,
      useFactory: (
        nodes: NodeEligibilityPort,
        tokens: BootstrapTokenStorePort,
        unitOfWork: ConstructorParameters<typeof IssueBootstrapTokenUseCase>[2],
        outbox: ConstructorParameters<typeof IssueBootstrapTokenUseCase>[3],
      ) => new IssueBootstrapTokenUseCase(nodes, tokens, unitOfWork, outbox),
      inject: [
        NODE_ELIGIBILITY_PORT,
        BOOTSTRAP_TOKEN_STORE,
        UNIT_OF_WORK_PORT,
        OUTBOX_WRITER_PORT,
      ],
    },
  ],
})
export class AgentManagementModule {}

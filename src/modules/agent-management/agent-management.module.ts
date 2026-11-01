import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { EnrollAgentUseCase } from './application/enroll-agent.use-case';
import { ENROLLMENT_PERSISTENCE_PORT } from './application/enrollment.port';
import type { EnrollmentPersistencePort } from './application/enrollment.port';
import { ENROLLMENT_RECOVERY_CIPHER } from './application/enrollment-recovery.port';
import type { EnrollmentRecoveryCipherPort } from './application/enrollment-recovery.port';
import { MongoEnrollmentStore } from './infrastructure/mongodb/mongo-enrollment.store';
import { EnrollmentRecoveryCipher } from './infrastructure/security/enrollment-recovery-cipher';
import { EnrollmentController } from './presentation/enrollment.controller';
import { MongoBootstrapTokenStore } from './infrastructure/mongodb/mongo-bootstrap-token.store';
import { BootstrapTokenController } from './presentation/bootstrap-token.controller';

@Module({
  imports: [AssetTopologyModule],
  controllers: [BootstrapTokenController, EnrollmentController],
  providers: [
    MongoBootstrapTokenStore,
    {
      provide: ENROLLMENT_RECOVERY_CIPHER,
      useFactory: (config: ConfigService): EnrollmentRecoveryCipherPort =>
        new EnrollmentRecoveryCipher(
          config.getOrThrow<string>('AGENT_ENROLLMENT_RECOVERY_KEY'),
        ),
      inject: [ConfigService],
    },
    MongoEnrollmentStore,
    { provide: BOOTSTRAP_TOKEN_STORE, useExisting: MongoBootstrapTokenStore },
    { provide: ENROLLMENT_PERSISTENCE_PORT, useExisting: MongoEnrollmentStore },
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
    {
      provide: EnrollAgentUseCase,
      useFactory: (
        persistence: EnrollmentPersistencePort,
        nodes: NodeEligibilityPort,
        unitOfWork: ConstructorParameters<typeof IssueBootstrapTokenUseCase>[2],
        outbox: ConstructorParameters<typeof IssueBootstrapTokenUseCase>[3],
        config: ConfigService,
        recoveryCipher: EnrollmentRecoveryCipherPort,
      ) =>
        new EnrollAgentUseCase(
          persistence,
          nodes,
          unitOfWork,
          outbox,
          config.getOrThrow<string>('AGENT_CONTROL_PLANE_BASE_URL'),
          recoveryCipher,
          undefined,
          undefined,
          undefined,
        ),
      inject: [
        ENROLLMENT_PERSISTENCE_PORT,
        NODE_ELIGIBILITY_PORT,
        UNIT_OF_WORK_PORT,
        OUTBOX_WRITER_PORT,
        ConfigService,
        ENROLLMENT_RECOVERY_CIPHER,
      ],
    },
  ],
})
export class AgentManagementModule {}

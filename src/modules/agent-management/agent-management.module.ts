import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OUTBOX_WRITER_PORT, UNIT_OF_WORK_PORT } from '@platform/events';
import type { UnitOfWorkContext } from '@platform/events';
import { AssetTopologyModule } from '@modules/asset-topology/asset-topology.module';
import {
  ASSET_TOPOLOGY_AGENT_ENROLLMENT_COMMANDS_PORT,
  ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
} from '@modules/asset-topology/contracts';
import type {
  AssetTopologyAgentEnrollmentCommands,
  AssetTopologyAssetQueries,
  AssetId,
} from '@modules/asset-topology/contracts';
import { AGENT_BINDING_QUERIES_PORT } from './contracts';
import {
  BOOTSTRAP_TOKEN_STORE,
  NODE_ELIGIBILITY_PORT,
} from './application/registration/ports/bootstrap-token.port';
import type {
  BootstrapTokenStorePort,
  NodeEligibilityPort,
} from './application/registration/ports/bootstrap-token.port';
import { IssueBootstrapTokenUseCase } from './application/registration/use-cases/issue-bootstrap-token.use-case';
import { EnrollAgentUseCase } from './application/registration/use-cases/enroll-agent.use-case';
import { ENROLLMENT_PERSISTENCE_PORT } from './application/registration/ports/enrollment.port';
import type { EnrollmentPersistencePort } from './application/registration/ports/enrollment.port';
import { ENROLLMENT_RECOVERY_CIPHER } from './application/registration/ports/enrollment-recovery.port';
import type { EnrollmentRecoveryCipherPort } from './application/registration/ports/enrollment-recovery.port';
import { BINDING_REVOCATION_PORT } from './application/access-lifecycle/ports/binding-revocation.port';
import type { BindingRevocationPort } from './application/access-lifecycle/ports/binding-revocation.port';
import { MongoEnrollmentStore } from './infrastructure/mongodb/mongo-enrollment.store';
import { MongoAgentAccessStore } from './infrastructure/mongodb/mongo-agent-access.store';
import { RevokeAgentBindingUseCase } from './application/access-lifecycle/use-cases/revoke-agent-binding.use-case';
import { AgentBindingRevocationController } from './presentation/access-lifecycle/agent-binding-revocation.controller';
import { EnrollmentRecoveryCipher } from './infrastructure/security/enrollment-recovery-cipher';
import { EnrollmentController } from './presentation/registration/enrollment.controller';
import { MongoBootstrapTokenStore } from './infrastructure/mongodb/mongo-bootstrap-token.store';
import { BootstrapTokenController } from './presentation/registration/bootstrap-token.controller';
import { AgentRegistryController } from './presentation/agent-registry/agent-registry.controller';
import { AGENT_REGISTRY_QUERY_PORT } from './application/agent-registry/ports/agent-registry-query.port';
import type { AgentRegistryQueryPort } from './application/agent-registry/ports/agent-registry-query.port';
import { ListAgentInstallationsUseCase } from './application/agent-registry/use-cases/list-agent-installations.use-case';
import { GetAgentInstallationUseCase } from './application/agent-registry/use-cases/get-agent-installation.use-case';
import { ListInstallationBindingsUseCase } from './application/agent-registry/use-cases/list-installation-bindings.use-case';
import { MongoAgentRegistryQueryStore } from './infrastructure/mongodb/mongo-agent-registry-query.store';
import { FLEET_INVITATION_PORT } from './application/fleet/ports/fleet-invitation.port';
import { FLEET_INSTALLATION_PORT } from './application/fleet/ports/fleet-installation.port';
import { FleetManagerAdapterModule } from './infrastructure/fleet/fleet-manager-adapter.module';
import { FleetInvitationController } from './presentation/fleet-enrollment/fleet-invitation.controller';
import { MongoFleetEnrollmentOperationStore } from './infrastructure/mongodb/mongo-fleet-enrollment-operation.store';
import { FLEET_ENROLLMENT_OPERATION_PORT } from './application/fleet/ports/fleet-enrollment-operation.port';
import type { FleetEnrollmentOperationPort } from './application/fleet/ports/fleet-enrollment-operation.port';
import type { FleetInvitationPort } from './application/fleet/ports/fleet-invitation.port';
import type { FleetInstallationPort } from './application/fleet/ports/fleet-installation.port';
import { RequestFleetInvitationUseCase } from './application/fleet/use-cases/request-fleet-invitation.use-case';
import { FLEET_BINDING_PROJECTION_PORT } from './application/fleet/ports/fleet-binding-projection.port';
import type { FleetBindingProjectionPort } from './application/fleet/ports/fleet-binding-projection.port';
import { MongoFleetBindingProjectionStore } from './infrastructure/mongodb/mongo-fleet-binding-projection.store';
import { FleetEnrollmentSyncController } from './presentation/fleet-enrollment/fleet-enrollment-sync.controller';
import { SynchronizeFleetEnrollmentUseCase } from './application/fleet/use-cases/synchronize-fleet-enrollment.use-case';
import { CoordinateNodeLifecycleUseCase } from './application/fleet/use-cases/coordinate-node-lifecycle.use-case';
import { AGENT_NODE_LIFECYCLE_COORDINATION_PORT } from './contracts';

@Module({
  imports: [forwardRef(() => AssetTopologyModule), FleetManagerAdapterModule],
  controllers: [
    BootstrapTokenController,
    EnrollmentController,
    AgentBindingRevocationController,
    AgentRegistryController,
    FleetInvitationController,
    FleetEnrollmentSyncController,
  ],
  providers: [
    CoordinateNodeLifecycleUseCase,
    {
      provide: AGENT_NODE_LIFECYCLE_COORDINATION_PORT,
      useExisting: CoordinateNodeLifecycleUseCase,
    },
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
    MongoAgentAccessStore,
    MongoAgentRegistryQueryStore,
    MongoFleetEnrollmentOperationStore,
    MongoFleetBindingProjectionStore,
    {
      provide: FLEET_BINDING_PROJECTION_PORT,
      useExisting: MongoFleetBindingProjectionStore,
    },
    {
      provide: FLEET_ENROLLMENT_OPERATION_PORT,
      useExisting: MongoFleetEnrollmentOperationStore,
    },
    {
      provide: AGENT_REGISTRY_QUERY_PORT,
      useExisting: MongoAgentRegistryQueryStore,
    },
    {
      provide: ListAgentInstallationsUseCase,
      useFactory: (query: AgentRegistryQueryPort) =>
        new ListAgentInstallationsUseCase(query),
      inject: [AGENT_REGISTRY_QUERY_PORT],
    },
    {
      provide: GetAgentInstallationUseCase,
      useFactory: (query: AgentRegistryQueryPort) =>
        new GetAgentInstallationUseCase(query),
      inject: [AGENT_REGISTRY_QUERY_PORT],
    },
    {
      provide: ListInstallationBindingsUseCase,
      useFactory: (query: AgentRegistryQueryPort) =>
        new ListInstallationBindingsUseCase(query),
      inject: [AGENT_REGISTRY_QUERY_PORT],
    },
    {
      provide: BINDING_REVOCATION_PORT,
      useExisting: MongoAgentAccessStore,
    },
    { provide: BOOTSTRAP_TOKEN_STORE, useExisting: MongoBootstrapTokenStore },
    { provide: ENROLLMENT_PERSISTENCE_PORT, useExisting: MongoEnrollmentStore },
    {
      provide: RevokeAgentBindingUseCase,
      useFactory: (
        access: BindingRevocationPort,
        unitOfWork: ConstructorParameters<typeof IssueBootstrapTokenUseCase>[2],
        outbox: ConstructorParameters<typeof IssueBootstrapTokenUseCase>[3],
      ) => new RevokeAgentBindingUseCase(access, unitOfWork, outbox),
      inject: [BINDING_REVOCATION_PORT, UNIT_OF_WORK_PORT, OUTBOX_WRITER_PORT],
    },
    {
      provide: AGENT_BINDING_QUERIES_PORT,
      useFactory: (
        persistence: EnrollmentPersistencePort,
        fleetBindings: FleetBindingProjectionPort,
      ) => ({
        hasActiveBindingForNode: async (
          nodeId: string,
          context: UnitOfWorkContext,
        ) =>
          (await persistence.hasActiveBinding(nodeId, context)) ||
          (await fleetBindings.hasActiveForNode(nodeId, context)),
      }),
      inject: [ENROLLMENT_PERSISTENCE_PORT, FLEET_BINDING_PROJECTION_PORT],
    },
    {
      provide: NODE_ELIGIBILITY_PORT,
      useFactory: (
        assets: AssetTopologyAssetQueries,
        assetCommands: AssetTopologyAgentEnrollmentCommands,
      ) => ({
        getEligibility: (nodeId: string) =>
          assets.getAgentEnrollmentNodeEligibility(nodeId as AssetId),
        serializeEnrollmentEligibility: (
          nodeId: string,
          context: UnitOfWorkContext,
        ) => assetCommands.serializeAgentEnrollment(nodeId as AssetId, context),
      }),
      inject: [
        ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
        ASSET_TOPOLOGY_AGENT_ENROLLMENT_COMMANDS_PORT,
      ],
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
    {
      provide: RequestFleetInvitationUseCase,
      useFactory: (
        nodes: NodeEligibilityPort,
        persistence: EnrollmentPersistencePort,
        fleetInstallations: FleetInstallationPort,
        fleetInvitations: FleetInvitationPort,
        operations: FleetEnrollmentOperationPort,
        unitOfWork: ConstructorParameters<typeof IssueBootstrapTokenUseCase>[2],
        outbox: ConstructorParameters<typeof IssueBootstrapTokenUseCase>[3],
      ) =>
        new RequestFleetInvitationUseCase(
          nodes,
          persistence,
          fleetInstallations,
          fleetInvitations,
          operations,
          unitOfWork,
          outbox,
        ),
      inject: [
        NODE_ELIGIBILITY_PORT,
        ENROLLMENT_PERSISTENCE_PORT,
        FLEET_INSTALLATION_PORT,
        FLEET_INVITATION_PORT,
        FLEET_ENROLLMENT_OPERATION_PORT,
        UNIT_OF_WORK_PORT,
        OUTBOX_WRITER_PORT,
      ],
    },
    {
      provide: SynchronizeFleetEnrollmentUseCase,
      useFactory: (
        operations: FleetEnrollmentOperationPort,
        invitations: FleetInvitationPort,
        installations: FleetInstallationPort,
        nodes: NodeEligibilityPort,
        bindings: FleetBindingProjectionPort,
        unitOfWork: ConstructorParameters<typeof IssueBootstrapTokenUseCase>[2],
        outbox: ConstructorParameters<typeof IssueBootstrapTokenUseCase>[3],
      ) =>
        new SynchronizeFleetEnrollmentUseCase(
          operations,
          invitations,
          installations,
          nodes,
          bindings,
          unitOfWork,
          outbox,
        ),
      inject: [
        FLEET_ENROLLMENT_OPERATION_PORT,
        FLEET_INVITATION_PORT,
        FLEET_INSTALLATION_PORT,
        NODE_ELIGIBILITY_PORT,
        FLEET_BINDING_PROJECTION_PORT,
        UNIT_OF_WORK_PORT,
        OUTBOX_WRITER_PORT,
      ],
    },
  ],
  exports: [AGENT_BINDING_QUERIES_PORT, AGENT_NODE_LIFECYCLE_COORDINATION_PORT],
})
export class AgentManagementModule {}

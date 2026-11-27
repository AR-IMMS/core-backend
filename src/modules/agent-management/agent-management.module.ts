import { forwardRef, Module } from '@nestjs/common';
import { OUTBOX_WRITER_PORT, UNIT_OF_WORK_PORT } from '@platform/events';
import type { OutboxWriterPort, UnitOfWorkPort } from '@platform/events';
import { AssetTopologyModule } from '@modules/asset-topology/asset-topology.module';
import { ASSET_TOPOLOGY_ASSET_QUERIES_PORT } from '@modules/asset-topology/contracts';
import type {
  AssetId,
  AssetTopologyAssetQueries,
} from '@modules/asset-topology/contracts';
import {
  AGENT_BINDING_QUERIES_PORT,
  AGENT_NODE_LIFECYCLE_COORDINATION_PORT,
} from './contracts';
import type { AgentBindingQueries } from './contracts';
import { NODE_ELIGIBILITY_PORT } from './application/fleet/ports/node-eligibility.port';
import type { NodeEligibilityPort } from './application/fleet/ports/node-eligibility.port';
import { FLEET_INVITATION_PORT } from './application/fleet/ports/fleet-invitation.port';
import type { FleetInvitationPort } from './application/fleet/ports/fleet-invitation.port';
import { FLEET_INSTALLATION_PORT } from './application/fleet/ports/fleet-installation.port';
import type { FleetInstallationPort } from './application/fleet/ports/fleet-installation.port';
import { FLEET_ENROLLMENT_OPERATION_PORT } from './application/fleet/ports/fleet-enrollment-operation.port';
import type { FleetEnrollmentOperationPort } from './application/fleet/ports/fleet-enrollment-operation.port';
import { FLEET_BINDING_PROJECTION_PORT } from './application/fleet/ports/fleet-binding-projection.port';
import type { FleetBindingProjectionPort } from './application/fleet/ports/fleet-binding-projection.port';
import { RequestFleetInvitationUseCase } from './application/fleet/use-cases/request-fleet-invitation.use-case';
import { SynchronizeFleetEnrollmentUseCase } from './application/fleet/use-cases/synchronize-fleet-enrollment.use-case';
import { CoordinateNodeLifecycleUseCase } from './application/fleet/use-cases/coordinate-node-lifecycle.use-case';
import { FleetInvitationController } from './presentation/fleet-enrollment/fleet-invitation.controller';
import { FleetEnrollmentSyncController } from './presentation/fleet-enrollment/fleet-enrollment-sync.controller';
import { FleetManagerAdapterModule } from './infrastructure/fleet/fleet-manager-adapter.module';
import { MongoFleetEnrollmentOperationStore } from './infrastructure/mongodb/mongo-fleet-enrollment-operation.store';
import { MongoFleetBindingProjectionStore } from './infrastructure/mongodb/mongo-fleet-binding-projection.store';

@Module({
  imports: [forwardRef(() => AssetTopologyModule), FleetManagerAdapterModule],
  controllers: [FleetInvitationController, FleetEnrollmentSyncController],
  providers: [
    CoordinateNodeLifecycleUseCase,
    {
      provide: AGENT_NODE_LIFECYCLE_COORDINATION_PORT,
      useExisting: CoordinateNodeLifecycleUseCase,
    },
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
      provide: AGENT_BINDING_QUERIES_PORT,
      useFactory: (
        fleetBindings: FleetBindingProjectionPort,
      ): AgentBindingQueries => ({
        hasActiveBindingForNode: (nodeId, context) =>
          fleetBindings.hasActiveForNode(nodeId, context),
      }),
      inject: [FLEET_BINDING_PROJECTION_PORT],
    },
    {
      provide: NODE_ELIGIBILITY_PORT,
      useFactory: (assets: AssetTopologyAssetQueries): NodeEligibilityPort => ({
        getEligibility: (nodeId) =>
          assets.getAgentEnrollmentNodeEligibility(nodeId as AssetId),
      }),
      inject: [ASSET_TOPOLOGY_ASSET_QUERIES_PORT],
    },
    {
      provide: RequestFleetInvitationUseCase,
      useFactory: (
        nodes: NodeEligibilityPort,
        bindings: FleetBindingProjectionPort,
        fleetInstallations: FleetInstallationPort,
        fleetInvitations: FleetInvitationPort,
        operations: FleetEnrollmentOperationPort,
        unitOfWork: UnitOfWorkPort,
        outbox: OutboxWriterPort,
      ) =>
        new RequestFleetInvitationUseCase(
          nodes,
          bindings,
          fleetInstallations,
          fleetInvitations,
          operations,
          unitOfWork,
          outbox,
        ),
      inject: [
        NODE_ELIGIBILITY_PORT,
        FLEET_BINDING_PROJECTION_PORT,
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
        unitOfWork: UnitOfWorkPort,
        outbox: OutboxWriterPort,
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

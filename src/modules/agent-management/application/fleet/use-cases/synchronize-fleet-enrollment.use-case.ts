import { randomUUID } from 'node:crypto';
import type {
  AuditFactV2,
  OutboxWriterPort,
  UnitOfWorkPort,
} from '@platform/events';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION_V2,
} from '@platform/events';
import {
  FleetConflictError,
  FleetNotFoundError,
  FleetProtocolError,
  FleetUnavailableError,
} from '../errors/fleet-errors';
import { FleetOperationPendingError } from '../errors/fleet-operation-pending.error';
import type { FleetActorContext, FleetInvitationView } from '../fleet.types';
import type { FleetInvitationPort } from '../ports/fleet-invitation.port';
import type { FleetInstallationPort } from '../ports/fleet-installation.port';
import type { FleetEnrollmentOperationPort } from '../ports/fleet-enrollment-operation.port';
import type { FleetBindingProjectionPort } from '../ports/fleet-binding-projection.port';
import type { NodeEligibilityPort } from '../../registration/ports/bootstrap-token.port';

export interface FleetEnrollmentSyncResponse {
  readonly operationId: string;
  readonly invitationId: string;
  readonly nodeId: string;
  readonly status:
    'PENDING' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED' | 'UNKNOWN' | 'BOUND';
  readonly installationId?: string;
}

export class SynchronizeFleetEnrollmentUseCase {
  constructor(
    private readonly operations: FleetEnrollmentOperationPort,
    private readonly invitations: FleetInvitationPort,
    private readonly installations: FleetInstallationPort,
    private readonly nodes: NodeEligibilityPort,
    private readonly bindings: FleetBindingProjectionPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly outbox: OutboxWriterPort,
    private readonly now: () => Date = () => new Date(),
    private readonly generateId: () => string = randomUUID,
  ) {}

  async execute(input: {
    readonly invitationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetEnrollmentSyncResponse> {
    const operation = await this.operations.findByInvitationId(
      input.invitationId,
    );
    if (!operation) throw new FleetNotFoundError();
    if (
      operation.status === 'CANCELLED' ||
      operation.status === 'EXPIRED' ||
      operation.status === 'REVOKED'
    ) {
      throw new FleetConflictError('FLEET_OPERATION_TERMINAL');
    }

    let invitation: FleetInvitationView | null;
    try {
      invitation = await this.invitations.getByOperation({
        operationId: operation.operationId,
        actor: input.actor,
      });
    } catch (error) {
      if (error instanceof FleetUnavailableError) {
        throw new FleetOperationPendingError(
          operation.operationId,
          'FLEET_SYNC_READ',
        );
      }
      throw error;
    }
    if (!invitation) {
      throw new FleetOperationPendingError(
        operation.operationId,
        'FLEET_SYNC_READ',
      );
    }
    if (
      invitation.invitationId !== operation.invitationId ||
      invitation.nodeId !== operation.nodeId
    ) {
      throw new FleetProtocolError();
    }

    if (invitation.status === 'PENDING') {
      return this.response(
        operation.operationId,
        invitation,
        invitation.expiresAt <= this.now() ? 'EXPIRED' : 'PENDING',
      );
    }
    if (invitation.status === 'CANCELLED' || invitation.status === 'EXPIRED') {
      return this.response(
        operation.operationId,
        invitation,
        invitation.status,
      );
    }
    if (invitation.status === 'UNKNOWN') {
      return this.response(operation.operationId, invitation, 'UNKNOWN');
    }
    if (!invitation.installationId) throw new FleetProtocolError();

    const installation = await this.installations.findById({
      installationId: invitation.installationId,
      actor: input.actor,
    });
    if (!installation || installation.status !== 'ACTIVE') {
      throw new FleetConflictError('FLEET_INSTALLATION_NOT_ACTIVE');
    }
    if (installation.nodeId !== operation.nodeId) {
      throw new FleetProtocolError();
    }
    const node = await this.nodes.getEligibility(operation.nodeId);
    if (!node.exists || !node.active || !node.hasActivePlacement) {
      throw new FleetConflictError('NODE_STATE_CHANGED_DURING_ENROLLMENT');
    }

    await this.markSyncPending(operation.operationId, invitation);
    const bindingId = `fleet:${invitation.invitationId}`;
    try {
      await this.unitOfWork.run(async (context) => {
        const result = await this.bindings.upsert(
          {
            bindingId,
            invitationId: invitation.invitationId,
            installationId: installation.installationId,
            nodeId: operation.nodeId,
            createdAt: this.now(),
          },
          context,
        );
        if (result === 'REVOKED' || result === 'CONFLICT') {
          throw new FleetConflictError(
            result === 'REVOKED'
              ? 'FLEET_BINDING_ALREADY_REVOKED'
              : 'NODE_OR_INSTALLATION_ALREADY_BOUND',
          );
        }
        await this.operations.markBound(
          {
            operationId: operation.operationId,
            installationId: installation.installationId,
            updatedAt: this.now(),
          },
          context,
        );
        if (result === 'CREATED') {
          await this.outbox.append(
            this.auditFact(
              input.actor,
              operation.nodeId,
              invitation,
              installation.installationId,
            ),
            context,
          );
        }
      });
    } catch (error) {
      if (error instanceof FleetConflictError) throw error;
      throw new FleetOperationPendingError(
        operation.operationId,
        'CORE_BINDING_SYNC',
      );
    }
    return this.response(
      operation.operationId,
      invitation,
      'BOUND',
      installation.installationId,
    );
  }

  private async markSyncPending(
    operationId: string,
    invitation: FleetInvitationView,
  ): Promise<void> {
    try {
      await this.unitOfWork.run((context) =>
        this.operations.recordInvitation(
          {
            operationId,
            invitationId: invitation.invitationId,
            status: 'REDEEMED',
            installationId: invitation.installationId,
            expiresAt: invitation.expiresAt,
            updatedAt: this.now(),
          },
          context,
        ),
      );
    } catch {
      throw new FleetOperationPendingError(operationId, 'SYNC_PENDING_RECORD');
    }
  }

  private response(
    operationId: string,
    invitation: FleetInvitationView,
    status: FleetEnrollmentSyncResponse['status'],
    installationId?: string,
  ): FleetEnrollmentSyncResponse {
    return {
      operationId,
      invitationId: invitation.invitationId,
      nodeId: invitation.nodeId,
      status,
      ...(installationId ? { installationId } : {}),
    };
  }

  private auditFact(
    actor: FleetActorContext,
    nodeId: string,
    invitation: FleetInvitationView,
    installationId: string,
  ): AuditFactV2 {
    return {
      event_id: this.generateId(),
      event_type: AUDIT_FACT_EVENT_TYPE,
      event_version: AUDIT_FACT_EVENT_VERSION_V2,
      producer: 'agent-management',
      occurred_at: this.now().toISOString(),
      resource: {
        type: 'agent-management.fleet-binding',
        id: `fleet:${invitation.invitationId}`,
        sequence: 1,
      },
      payload: {
        actor: { type: 'user', id: actor.actorId },
        action: 'agent_management.fleet_enrollment.synchronized',
        changes: [
          { field: 'node_id', after: nodeId },
          { field: 'invitation_id', after: invitation.invitationId },
          { field: 'agent_id', after: installationId },
        ],
      },
      context: {
        request_id: actor.requestId,
      },
    };
  }
}

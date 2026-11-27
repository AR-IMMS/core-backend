import { createHash, randomUUID } from 'node:crypto';
import type {
  AuditFactV2,
  OutboxWriterPort,
  UnitOfWorkPort,
} from '@platform/events';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION_V2,
} from '@platform/events';
import type { NodeEligibilityPort } from '../ports/node-eligibility.port';
import type { FleetBindingProjectionPort } from '../ports/fleet-binding-projection.port';
import {
  AgentNodeNotEligibleError,
  AgentNodeNotFoundError,
} from '../errors/node-eligibility.errors';
import {
  FleetConflictError,
  FleetProtocolError,
  FleetUnavailableError,
} from '../errors/fleet-errors';
import { FleetOperationPendingError } from '../errors/fleet-operation-pending.error';
import type { FleetActorContext, FleetInvitationView } from '../fleet.types';
import type { FleetInvitationPort } from '../ports/fleet-invitation.port';
import type { FleetInstallationPort } from '../ports/fleet-installation.port';
import type {
  FleetEnrollmentOperation,
  FleetEnrollmentOperationPort,
} from '../ports/fleet-enrollment-operation.port';

const INVITATION_TTL_SECONDS = 600;

export interface FleetInvitationOperationResponse {
  readonly operationId: string;
  readonly invitationId?: string;
  readonly nodeId?: string;
  readonly status:
    | 'REQUEST_PENDING'
    | 'PENDING'
    | 'REDEEMED'
    | 'CANCELLED'
    | 'EXPIRED'
    | 'REVOKED'
    | 'UNKNOWN';
  readonly expiresAt?: Date;
  readonly invitationToken?: string;
  readonly installationId?: string;
}

export class RequestFleetInvitationUseCase {
  constructor(
    private readonly nodes: NodeEligibilityPort,
    private readonly bindings: FleetBindingProjectionPort,
    private readonly fleetInstallations: FleetInstallationPort,
    private readonly fleetInvitations: FleetInvitationPort,
    private readonly operations: FleetEnrollmentOperationPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly outbox: OutboxWriterPort,
    private readonly now: () => Date = () => new Date(),
    private readonly generateId: () => string = randomUUID,
  ) {}

  async execute(input: {
    readonly nodeId: string;
    readonly idempotencyKey: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInvitationOperationResponse> {
    const idempotencyHash = hash(input.idempotencyKey);
    const fingerprint = hash(
      JSON.stringify({
        action: 'create-invitation',
        actorId: input.actor.actorId,
        nodeId: input.nodeId,
        ttl: INVITATION_TTL_SECONDS,
      }),
    );
    const previous =
      await this.operations.findByIdempotencyHash(idempotencyHash);
    if (previous) {
      this.assertSameRequest(previous, fingerprint, input.actor.actorId);
      return this.readReplay(previous, input.actor);
    }

    await this.assertNodeEligible(input.nodeId, input.actor);
    const result = await this.operations.begin({
      operationId: this.generateId(),
      idempotencyHash,
      fingerprint,
      actorId: input.actor.actorId,
      nodeId: input.nodeId,
      createdAt: this.now(),
    });
    this.assertSameRequest(result.operation, fingerprint, input.actor.actorId);
    if (!result.created) return this.readReplay(result.operation, input.actor);

    let invitation: FleetInvitationView;
    try {
      invitation = await this.fleetInvitations.create({
        nodeId: input.nodeId,
        operationId: result.operation.operationId,
        idempotencyKey: result.operation.operationId,
        requestedTtlSeconds: INVITATION_TTL_SECONDS,
        actor: input.actor,
      });
    } catch (error) {
      if (error instanceof FleetUnavailableError && error.outcomeUnknown) {
        throw new FleetOperationPendingError(
          result.operation.operationId,
          'FLEET_CREATE_UNKNOWN',
        );
      }
      throw error;
    }
    await this.persistInvitation(result.operation, invitation, input.actor);
    return this.toResponse(invitation, result.operation.operationId);
  }

  private async assertNodeEligible(
    nodeId: string,
    actor: FleetActorContext,
  ): Promise<void> {
    const node = await this.nodes.getEligibility(nodeId);
    if (!node.exists) throw new AgentNodeNotFoundError();
    if (!node.active || !node.hasActivePlacement) {
      throw new AgentNodeNotEligibleError();
    }
    if (await this.bindings.hasActiveForNode(nodeId)) {
      throw new AgentNodeNotEligibleError();
    }
    const fleetBinding = await this.fleetInstallations.findActiveByNode({
      nodeId,
      actor,
    });
    if (fleetBinding?.status === 'ACTIVE') {
      throw new AgentNodeNotEligibleError();
    }
  }

  private async readReplay(
    operation: FleetEnrollmentOperation,
    actor: FleetActorContext,
  ): Promise<FleetInvitationOperationResponse> {
    if (
      operation.status === 'CANCELLED' ||
      operation.status === 'EXPIRED' ||
      operation.status === 'REVOKED'
    ) {
      return {
        operationId: operation.operationId,
        ...(operation.invitationId
          ? { invitationId: operation.invitationId }
          : {}),
        nodeId: operation.nodeId,
        status: operation.status,
      };
    }
    if (operation.status === 'BOUND') {
      return {
        operationId: operation.operationId,
        ...(operation.invitationId
          ? { invitationId: operation.invitationId }
          : {}),
        nodeId: operation.nodeId,
        status: 'REDEEMED',
        ...(operation.installationId
          ? { installationId: operation.installationId }
          : {}),
      };
    }
    let invitation: FleetInvitationView | null;
    try {
      invitation = await this.fleetInvitations.getByOperation({
        operationId: operation.operationId,
        actor,
      });
    } catch (error) {
      if (error instanceof FleetUnavailableError && error.outcomeUnknown) {
        throw new FleetOperationPendingError(
          operation.operationId,
          'FLEET_READ',
        );
      }
      throw error;
    }
    if (!invitation) {
      if (
        operation.status !== 'REQUEST_PENDING' &&
        operation.status !== 'INVITATION_ISSUED'
      ) {
        return {
          operationId: operation.operationId,
          status: 'REQUEST_PENDING' as const,
        };
      }
      invitation = await this.replayPendingCreate(operation, actor);
    }
    if (invitation.nodeId !== operation.nodeId) {
      throw new FleetUnavailableError(false);
    }
    if (invitation.status === 'PENDING' && !invitation.invitationToken) {
      invitation = await this.replayPendingCreate(operation, actor);
    }
    if (
      invitation.status === 'PENDING' &&
      invitation.expiresAt &&
      invitation.expiresAt <= this.now()
    ) {
      invitation = {
        ...invitation,
        status: 'EXPIRED',
        invitationToken: undefined,
      };
    }
    await this.persistInvitation(operation, invitation, actor);
    return this.toResponse(invitation, operation.operationId);
  }

  private async replayPendingCreate(
    operation: FleetEnrollmentOperation,
    actor: FleetActorContext,
  ): Promise<FleetInvitationView> {
    try {
      return await this.fleetInvitations.create({
        nodeId: operation.nodeId,
        operationId: operation.operationId,
        idempotencyKey: operation.operationId,
        requestedTtlSeconds: INVITATION_TTL_SECONDS,
        actor,
      });
    } catch (error) {
      if (error instanceof FleetConflictError) {
        try {
          const current = await this.fleetInvitations.getByOperation({
            operationId: operation.operationId,
            actor,
          });
          if (current && current.status !== 'PENDING') return current;
        } catch (readError) {
          if (readError instanceof FleetUnavailableError) {
            throw new FleetOperationPendingError(
              operation.operationId,
              'FLEET_READ_AFTER_CREATE_CONFLICT',
            );
          }
          throw readError;
        }
      }
      if (error instanceof FleetUnavailableError && error.outcomeUnknown) {
        throw new FleetOperationPendingError(
          operation.operationId,
          'FLEET_CREATE_UNKNOWN',
        );
      }
      throw error;
    }
  }

  private async persistInvitation(
    operation: FleetEnrollmentOperation,
    invitation: FleetInvitationView,
    actor: FleetActorContext,
  ): Promise<void> {
    if (invitation.status === 'PENDING' && !invitation.expiresAt) {
      throw new FleetProtocolError();
    }
    try {
      await this.unitOfWork.run(async (context) => {
        const firstRecording = await this.operations.recordInvitation(
          {
            operationId: operation.operationId,
            invitationId: invitation.invitationId,
            status: invitation.status,
            installationId: invitation.installationId,
            ...(invitation.expiresAt
              ? { expiresAt: invitation.expiresAt }
              : {}),
            updatedAt: this.now(),
          },
          context,
        );
        if (firstRecording && invitation.status === 'PENDING') {
          const expiresAt = invitation.expiresAt;
          if (!expiresAt) throw new FleetProtocolError();
          await this.outbox.append(
            this.auditFact(operation, { ...invitation, expiresAt }, actor),
            context,
          );
        }
      });
    } catch {
      throw new FleetOperationPendingError(
        operation.operationId,
        'CORE_PERSISTENCE',
      );
    }
  }

  private toResponse(
    invitation: FleetInvitationView,
    operationId: string,
  ): FleetInvitationOperationResponse {
    const status =
      invitation.status === 'PENDING' &&
      invitation.expiresAt !== undefined &&
      invitation.expiresAt <= this.now()
        ? 'EXPIRED'
        : invitation.status;
    return {
      operationId,
      invitationId: invitation.invitationId,
      nodeId: invitation.nodeId,
      status,
      ...(invitation.expiresAt ? { expiresAt: invitation.expiresAt } : {}),
      ...(status === 'PENDING' && invitation.invitationToken
        ? { invitationToken: invitation.invitationToken }
        : {}),
      ...(invitation.installationId
        ? { installationId: invitation.installationId }
        : {}),
    };
  }

  private auditFact(
    operation: FleetEnrollmentOperation,
    invitation: FleetInvitationView & { readonly expiresAt: Date },
    actor: FleetActorContext,
  ): AuditFactV2 {
    return {
      event_id: this.generateId(),
      event_type: AUDIT_FACT_EVENT_TYPE,
      event_version: AUDIT_FACT_EVENT_VERSION_V2,
      producer: 'agent-management',
      occurred_at: this.now().toISOString(),
      resource: {
        type: 'agent-management.fleet-invitation',
        id: invitation.invitationId,
        sequence: 1,
      },
      payload: {
        actor: { type: 'user', id: actor.actorId },
        action: 'agent_management.fleet_invitation.created',
        changes: [
          { field: 'node_id', after: operation.nodeId },
          { field: 'invitation_id', after: invitation.invitationId },
          { field: 'expires_at', after: invitation.expiresAt.toISOString() },
        ],
      },
      context: { request_id: actor.requestId },
    };
  }

  private assertSameRequest(
    operation: FleetEnrollmentOperation,
    fingerprint: string,
    actorId: string,
  ): void {
    if (
      operation.fingerprint !== fingerprint ||
      operation.actorId !== actorId
    ) {
      throw new FleetConflictError('IDEMPOTENCY_KEY_REUSED');
    }
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

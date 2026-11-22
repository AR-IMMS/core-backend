import {
  FleetNotFoundError,
  FleetProtocolError,
} from '../../application/fleet/errors/fleet-errors';
import type { FleetInvitationPort } from '../../application/fleet/ports/fleet-invitation.port';
import type {
  FleetActorContext,
  FleetInvitationView,
  FleetInvitationState,
} from '../../application/fleet/fleet.types';
import { FleetHttpClient } from './fleet-http-client';

interface InvitationResponse {
  readonly invitation_id: string;
  readonly operation_id: string;
  readonly node_id: string;
  readonly status: FleetInvitationState;
  readonly expires_at: string;
  readonly invitation_token?: string;
  readonly installation_id?: string;
}

export class FleetInvitationHttpAdapter implements FleetInvitationPort {
  constructor(private readonly client: FleetHttpClient) {}

  async create(input: {
    readonly nodeId: string;
    readonly operationId: string;
    readonly idempotencyKey: string;
    readonly requestedTtlSeconds: number;
    readonly actor: FleetActorContext;
  }): Promise<FleetInvitationView> {
    const response = await this.client.request<unknown>({
      method: 'POST',
      path: 'enrollment-invitations',
      actor: input.actor,
      operationId: input.operationId,
      idempotencyKey: input.idempotencyKey,
      body: {
        schema_version: 1,
        operation_id: input.operationId,
        node_id: input.nodeId,
        requested_ttl_seconds: input.requestedTtlSeconds,
      },
    });
    return toInvitation(response, input.operationId, input.nodeId);
  }

  async getByOperation(input: {
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInvitationView | null> {
    try {
      const response = await this.client.request<unknown>({
        method: 'GET',
        path: `enrollment-invitations/by-operation/${encodeURIComponent(input.operationId)}`,
        actor: input.actor,
        operationId: input.operationId,
      });
      return toInvitation(response, input.operationId);
    } catch (error) {
      if (error instanceof FleetNotFoundError) return null;
      throw error;
    }
  }

  async cancel(input: {
    readonly invitationId: string;
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<void> {
    await this.client.request<void>({
      method: 'POST',
      path: `enrollment-invitations/${encodeURIComponent(input.invitationId)}/cancel`,
      actor: input.actor,
      operationId: input.operationId,
      body: { schema_version: 1, operation_id: input.operationId },
    });
  }
}

function toInvitation(
  value: unknown,
  expectedOperationId: string,
  expectedNodeId?: string,
): FleetInvitationView {
  if (!isInvitationResponse(value)) throw new FleetProtocolError();
  if (
    value.operation_id !== expectedOperationId ||
    (expectedNodeId !== undefined && value.node_id !== expectedNodeId)
  ) {
    throw new FleetProtocolError();
  }
  const expiresAt = new Date(value.expires_at);
  if (Number.isNaN(expiresAt.getTime())) throw new FleetProtocolError();
  if (value.status === 'PENDING' && !value.invitation_token) {
    throw new FleetProtocolError();
  }
  if (value.status !== 'PENDING' && value.invitation_token) {
    throw new FleetProtocolError();
  }
  if (value.status === 'REDEEMED' && !value.installation_id) {
    throw new FleetProtocolError();
  }
  return {
    invitationId: value.invitation_id,
    operationId: value.operation_id,
    nodeId: value.node_id,
    status: value.status,
    expiresAt,
    ...(value.status === 'PENDING'
      ? { invitationToken: value.invitation_token }
      : {}),
    ...(value.installation_id ? { installationId: value.installation_id } : {}),
  };
}

function isInvitationResponse(value: unknown): value is InvitationResponse {
  if (!isRecord(value)) return false;
  const status = value['status'];
  return (
    typeof value['invitation_id'] === 'string' &&
    typeof value['operation_id'] === 'string' &&
    typeof value['node_id'] === 'string' &&
    (status === 'PENDING' ||
      status === 'REDEEMED' ||
      status === 'CANCELLED' ||
      status === 'EXPIRED' ||
      status === 'UNKNOWN') &&
    typeof value['expires_at'] === 'string' &&
    (value['invitation_token'] === undefined ||
      typeof value['invitation_token'] === 'string') &&
    (value['installation_id'] === undefined ||
      typeof value['installation_id'] === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

type FleetOperationStatus = 'PENDING' | 'EXCHANGED' | 'CANCELLED' | 'EXPIRED';

interface InvitationResponse {
  readonly schema_version: 1;
  readonly invitation_id: string;
  readonly operation_id: string;
  readonly node_id: string;
  readonly status: FleetOperationStatus;
  readonly expires_at?: string;
  readonly invitation_token?: string;
  readonly agent_id?: string;
  readonly credential_id?: string;
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
      path: 'enrollment/invitations',
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
    return toCreatedInvitation(response, input.operationId, input.nodeId);
  }

  async getByOperation(input: {
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInvitationView | null> {
    try {
      const response = await this.client.request<unknown>({
        method: 'GET',
        path: 'enrollment/operations/' + encodeURIComponent(input.operationId),
        actor: input.actor,
        operationId: input.operationId,
      });
      return toOperationStatus(response, input.operationId);
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
      path:
        'enrollment/invitations/' +
        encodeURIComponent(input.invitationId) +
        '/cancel',
      actor: input.actor,
      operationId: input.operationId,
      body: { schema_version: 1, operation_id: input.operationId },
    });
  }
}

function toCreatedInvitation(
  value: unknown,
  expectedOperationId: string,
  expectedNodeId: string,
): FleetInvitationView {
  if (!isInvitationResponse(value) || value.status !== 'PENDING') {
    throw new FleetProtocolError();
  }
  if (
    value.operation_id !== expectedOperationId ||
    value.node_id !== expectedNodeId ||
    !value.invitation_token ||
    !value.expires_at
  ) {
    throw new FleetProtocolError();
  }
  const expiresAt = parseExpiresAt(value.expires_at);
  if (!expiresAt) throw new FleetProtocolError();
  return {
    invitationId: value.invitation_id,
    operationId: value.operation_id,
    nodeId: value.node_id,
    status: 'PENDING',
    expiresAt,
    invitationToken: value.invitation_token,
  };
}

function toOperationStatus(
  value: unknown,
  expectedOperationId: string,
): FleetInvitationView {
  if (!isInvitationResponse(value) || value.invitation_token !== undefined) {
    throw new FleetProtocolError();
  }
  if (value.operation_id !== expectedOperationId) {
    throw new FleetProtocolError();
  }
  const expiresAt = value.expires_at
    ? parseExpiresAt(value.expires_at)
    : undefined;
  if (value.expires_at && !expiresAt) throw new FleetProtocolError();

  const status: FleetInvitationState =
    value.status === 'EXCHANGED' ? 'REDEEMED' : value.status;
  if (status === 'REDEEMED' && !value.agent_id) {
    throw new FleetProtocolError();
  }
  if (status !== 'REDEEMED' && value.agent_id !== undefined) {
    throw new FleetProtocolError();
  }
  return {
    invitationId: value.invitation_id,
    operationId: value.operation_id,
    nodeId: value.node_id,
    status,
    ...(expiresAt ? { expiresAt } : {}),
    ...(status === 'REDEEMED' && value.agent_id
      ? { installationId: value.agent_id }
      : {}),
  };
}

function isInvitationResponse(value: unknown): value is InvitationResponse {
  if (!isRecord(value)) return false;
  const status = value['status'];
  return (
    value['schema_version'] === 1 &&
    typeof value['invitation_id'] === 'string' &&
    value['invitation_id'].length > 0 &&
    typeof value['operation_id'] === 'string' &&
    typeof value['node_id'] === 'string' &&
    (status === 'PENDING' ||
      status === 'EXCHANGED' ||
      status === 'CANCELLED' ||
      status === 'EXPIRED') &&
    (value['expires_at'] === undefined ||
      typeof value['expires_at'] === 'string') &&
    (value['invitation_token'] === undefined ||
      typeof value['invitation_token'] === 'string') &&
    (value['agent_id'] === undefined ||
      typeof value['agent_id'] === 'string') &&
    (value['credential_id'] === undefined ||
      typeof value['credential_id'] === 'string')
  );
}

function parseExpiresAt(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

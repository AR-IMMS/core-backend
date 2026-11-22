import {
  FleetNotFoundError,
  FleetProtocolError,
} from '../../application/fleet/errors/fleet-errors';
import type { FleetInstallationPort } from '../../application/fleet/ports/fleet-installation.port';
import type {
  FleetActorContext,
  FleetEnrollmentGate,
  FleetInstallationView,
} from '../../application/fleet/fleet.types';
import { FleetHttpClient } from './fleet-http-client';

export class FleetInstallationHttpAdapter implements FleetInstallationPort {
  constructor(private readonly client: FleetHttpClient) {}

  async findById(input: {
    readonly installationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInstallationView | null> {
    return this.find(
      `installations/${encodeURIComponent(input.installationId)}`,
      input.actor,
      input.installationId,
    );
  }

  async findActiveByNode(input: {
    readonly nodeId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInstallationView | null> {
    return this.find(
      `nodes/${encodeURIComponent(input.nodeId)}/active-installation`,
      input.actor,
      input.nodeId,
    );
  }

  async closeEnrollmentGate(input: {
    readonly nodeId: string;
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetEnrollmentGate> {
    const value = await this.client.request<unknown>({
      method: 'POST',
      path: `nodes/${encodeURIComponent(input.nodeId)}/enrollment-gate/close`,
      actor: input.actor,
      operationId: input.operationId,
      body: { schema_version: 1, operation_id: input.operationId },
    });
    if (!isRecord(value) || !Number.isInteger(value['version'])) {
      throw new FleetProtocolError();
    }
    const previousState = value['previous_state'];
    if (previousState !== 'OPEN' && previousState !== 'CLOSED') {
      throw new FleetProtocolError();
    }
    return {
      nodeId: input.nodeId,
      operationId: input.operationId,
      version: value['version'] as number,
      previousState,
    };
  }

  async completeEnrollmentGate(input: {
    readonly gate: FleetEnrollmentGate;
    readonly state: 'OPEN' | 'CLOSED';
    readonly actor: FleetActorContext;
  }): Promise<void> {
    await this.client.request<void>({
      method: 'PUT',
      path: `nodes/${encodeURIComponent(input.gate.nodeId)}/enrollment-gate`,
      actor: input.actor,
      operationId: input.gate.operationId,
      body: {
        schema_version: 1,
        operation_id: input.gate.operationId,
        version: input.gate.version,
        state: input.state,
      },
    });
  }

  async revoke(input: {
    readonly installationId: string;
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<void> {
    await this.client.request<void>({
      method: 'POST',
      path: `installations/${encodeURIComponent(input.installationId)}/revoke`,
      actor: input.actor,
      operationId: input.operationId,
      body: { schema_version: 1, operation_id: input.operationId },
    });
  }

  private async find(
    path: string,
    actor: FleetActorContext,
    expectedId: string,
  ): Promise<FleetInstallationView | null> {
    try {
      const value = await this.client.request<unknown>({
        method: 'GET',
        path,
        actor,
        operationId: `read:${expectedId}`,
      });
      if (!isInstallation(value)) throw new FleetProtocolError();
      return {
        installationId: value.installation_id,
        nodeId: value.node_id ?? null,
        status: value.status,
      };
    } catch (error) {
      if (error instanceof FleetNotFoundError) return null;
      throw error;
    }
  }
}

interface InstallationResponse {
  readonly installation_id: string;
  readonly node_id?: string | null;
  readonly status: FleetInstallationView['status'];
}

function isInstallation(value: unknown): value is InstallationResponse {
  return (
    isRecord(value) &&
    typeof value['installation_id'] === 'string' &&
    (value['node_id'] === undefined ||
      value['node_id'] === null ||
      typeof value['node_id'] === 'string') &&
    (value['status'] === 'ACTIVE' ||
      value['status'] === 'REVOKED' ||
      value['status'] === 'UNKNOWN')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

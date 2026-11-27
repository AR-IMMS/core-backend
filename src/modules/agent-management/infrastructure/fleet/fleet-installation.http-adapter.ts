import {
  FleetNotFoundError,
  FleetProtocolError,
} from '../../application/ports/fleet/fleet-errors';
import type { FleetInstallationPort } from '../../application/ports/fleet/fleet-installation.port';
import type {
  FleetActorContext,
  FleetInstallationView,
} from '../../application/ports/fleet/fleet.types';
import { FleetHttpClient } from './fleet-http-client';

export class FleetInstallationHttpAdapter implements FleetInstallationPort {
  constructor(private readonly client: FleetHttpClient) {}

  async findById(input: {
    readonly installationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInstallationView | null> {
    return this.find(
      'installations/' + encodeURIComponent(input.installationId),
      input.actor,
      input.installationId,
      'installation_id',
    );
  }

  async findActiveByNode(input: {
    readonly nodeId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInstallationView | null> {
    return this.find(
      'nodes/' + encodeURIComponent(input.nodeId) + '/active-installation',
      input.actor,
      input.nodeId,
      'node_id',
    );
  }

  private async find(
    path: string,
    actor: FleetActorContext,
    expectedId: string,
    expectedIdentityField: 'installation_id' | 'node_id',
  ): Promise<FleetInstallationView | null> {
    try {
      const value = await this.client.request<unknown>({
        method: 'GET',
        path,
        actor,
        operationId: 'read:' + expectedId,
      });
      if (
        !isInstallation(value) ||
        value[expectedIdentityField] !== expectedId
      ) {
        throw new FleetProtocolError();
      }
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

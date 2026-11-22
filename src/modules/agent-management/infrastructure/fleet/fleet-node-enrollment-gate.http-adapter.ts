import { FleetProtocolError } from '../../application/fleet/errors/fleet-errors';
import type { FleetNodeEnrollmentGatePort } from '../../application/fleet/ports/fleet-node-enrollment-gate.port';
import type {
  FleetActorContext,
  FleetEnrollmentGate,
} from '../../application/fleet/fleet.types';
import { FleetHttpClient } from './fleet-http-client';

export class FleetNodeEnrollmentGateHttpAdapter implements FleetNodeEnrollmentGatePort {
  constructor(private readonly client: FleetHttpClient) {}

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
    if (!isRecord(value) || !Number.isInteger(value['version']))
      throw new FleetProtocolError();
    const previousState = value['previous_state'];
    if (previousState !== 'OPEN' && previousState !== 'CLOSED')
      throw new FleetProtocolError();
    const activeBinding = value['active_binding'];
    if (
      activeBinding !== null &&
      (!isRecord(activeBinding) ||
        typeof activeBinding['installation_id'] !== 'string' ||
        typeof activeBinding['binding_id'] !== 'string')
    )
      throw new FleetProtocolError();
    const binding =
      activeBinding === null
        ? null
        : {
            installationId: activeBinding['installation_id'] as string,
            bindingId: activeBinding['binding_id'] as string,
          };
    return {
      nodeId: input.nodeId,
      operationId: input.operationId,
      version: value['version'] as number,
      previousState,
      activeBinding: binding,
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import type { FleetActorContext } from '../../../application/ports/fleet/fleet.types';
import { FleetProtocolError } from '../../../application/ports/fleet/fleet-errors';
import type {
  FleetHttpConfig,
  FleetHttpExecutor,
  FleetHttpRequest,
  FleetHttpResponse,
} from '../fleet-http-client';
import { FleetHttpClient } from '../fleet-http-client';
import { FleetInvitationHttpAdapter } from '../fleet-invitation.http-adapter';
import { FleetInstallationHttpAdapter } from '../fleet-installation.http-adapter';
import { FleetNodeEnrollmentGateHttpAdapter } from '../fleet-node-enrollment-gate.http-adapter';

const config: FleetHttpConfig = {
  baseUrl: 'https://fleet.example.test/internal/v1/',
  clientCertificate: 'test-cert',
  clientKey: 'test-key',
  timeoutMs: 3_000,
  maxRetries: 0,
  maxResponseBytes: 8_192,
  maxRetryDelayMs: 1_000,
};
const actor: FleetActorContext = {
  actorId: 'human-123',
  requestId: 'request-123',
};

function makeAdapter(body: unknown, status = 200) {
  const calls: { url: URL; request: FleetHttpRequest }[] = [];
  const execute: FleetHttpExecutor = (url, request) => {
    calls.push({ url, request });
    return Promise.resolve({
      status,
      headers: {},
      body: status === 204 ? '' : JSON.stringify(body),
    } satisfies FleetHttpResponse);
  };
  return {
    client: new FleetHttpClient(config, execute, () => Promise.resolve()),
    calls,
  };
}

describe('Fleet invitation HTTP adapter', () => {
  test('creates with verified actor, operation ID, TTL, and idempotency key', async () => {
    const { client, calls } = makeAdapter(
      {
        schema_version: 1,
        invitation_id: 'invite-1',
        operation_id: 'op-1',
        node_id: 'node-1',
        status: 'PENDING',
        expires_at: '2026-11-22T00:10:00.000Z',
        invitation_token: 'one-time-secret',
      },
      201,
    );

    await expect(
      new FleetInvitationHttpAdapter(client).create({
        nodeId: 'node-1',
        operationId: 'op-1',
        idempotencyKey: 'same-key',
        requestedTtlSeconds: 600,
        actor,
      }),
    ).resolves.toMatchObject({
      invitationId: 'invite-1',
      status: 'PENDING',
      invitationToken: 'one-time-secret',
    });

    expect(calls[0].url.pathname).toBe('/internal/v1/enrollment/invitations');
    expect(calls[0].request).toMatchObject({
      operationId: 'op-1',
      idempotencyKey: 'same-key',
      actor,
      body: {
        schema_version: 1,
        operation_id: 'op-1',
        node_id: 'node-1',
        requested_ttl_seconds: 600,
      },
    });
  });

  test('reads secret-free installation projections from both Core lookup routes', async () => {
    const { client, calls } = makeAdapter({
      installation_id: 'install-1',
      node_id: 'node-1',
      status: 'ACTIVE',
    });
    const adapter = new FleetInstallationHttpAdapter(client);

    await expect(
      adapter.findById({ installationId: 'install-1', actor }),
    ).resolves.toEqual({
      installationId: 'install-1',
      nodeId: 'node-1',
      status: 'ACTIVE',
    });
    await expect(
      adapter.findActiveByNode({ nodeId: 'node-1', actor }),
    ).resolves.toEqual({
      installationId: 'install-1',
      nodeId: 'node-1',
      status: 'ACTIVE',
    });

    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/internal/v1/installations/install-1',
      '/internal/v1/nodes/node-1/active-installation',
    ]);
  });

  test('rejects an installation response for a different agent ID', async () => {
    const { client } = makeAdapter({
      installation_id: 'another-installation',
      node_id: 'node-1',
      status: 'ACTIVE',
    });

    await expect(
      new FleetInstallationHttpAdapter(client).findById({
        installationId: 'install-1',
        actor,
      }),
    ).rejects.toBeInstanceOf(FleetProtocolError);
  });

  test('rejects an active-installation response for a different Node ID', async () => {
    const { client } = makeAdapter({
      installation_id: 'install-1',
      node_id: 'another-node',
      status: 'ACTIVE',
    });

    await expect(
      new FleetInstallationHttpAdapter(client).findActiveByNode({
        nodeId: 'node-1',
        actor,
      }),
    ).rejects.toBeInstanceOf(FleetProtocolError);
  });
  test('cancels with the Fleet enrollment invitation route', async () => {
    const { client, calls } = makeAdapter({}, 204);

    await new FleetInvitationHttpAdapter(client).cancel({
      invitationId: 'invite-1',
      operationId: 'op-1',
      actor,
    });

    expect(calls[0].url.pathname).toBe(
      '/internal/v1/enrollment/invitations/invite-1/cancel',
    );
    expect(calls[0].request.body).toEqual({
      schema_version: 1,
      operation_id: 'op-1',
    });
  });
  test('decodes secret-free Fleet EXCHANGED status as Core REDEEMED', async () => {
    const payload = {
      schema_version: 1,
      operation_id: 'op-1',
      invitation_id: 'invite-1',
      node_id: 'node-1',
      status: 'EXCHANGED',
      agent_id: 'install-1',
      credential_id: 'credential-1',
    };
    const { client, calls } = makeAdapter(payload);

    await expect(
      new FleetInvitationHttpAdapter(client).getByOperation({
        operationId: 'op-1',
        actor,
      }),
    ).resolves.toEqual({
      invitationId: 'invite-1',
      operationId: 'op-1',
      nodeId: 'node-1',
      status: 'REDEEMED',
      installationId: 'install-1',
    });

    expect(calls[0].url.pathname).toBe(
      '/internal/v1/enrollment/operations/op-1',
    );
  });

  test('accepts pending status without an expiry or token', async () => {
    const { client } = makeAdapter({
      schema_version: 1,
      operation_id: 'op-1',
      invitation_id: 'invite-1',
      node_id: 'node-1',
      status: 'PENDING',
    });

    await expect(
      new FleetInvitationHttpAdapter(client).getByOperation({
        operationId: 'op-1',
        actor,
      }),
    ).resolves.toEqual({
      invitationId: 'invite-1',
      operationId: 'op-1',
      nodeId: 'node-1',
      status: 'PENDING',
    });
  });

  test('rejects operation status that includes a stale invitation secret', async () => {
    const { client } = makeAdapter({
      schema_version: 1,
      invitation_id: 'invite-1',
      operation_id: 'op-1',
      node_id: 'node-1',
      status: 'EXPIRED',
      invitation_token: 'stale-secret',
    });

    await expect(
      new FleetInvitationHttpAdapter(client).getByOperation({
        operationId: 'op-1',
        actor,
      }),
    ).rejects.toBeInstanceOf(FleetProtocolError);
  });
});

describe('Fleet Node enrollment gate HTTP adapter', () => {
  test('uses the gate operation owner and version for compare-and-complete', async () => {
    const calls: FleetHttpRequest[] = [];
    const execute: FleetHttpExecutor = (_url, request) => {
      calls.push(request);
      return Promise.resolve({
        status: 200,
        headers: {},
        body: JSON.stringify(
          request.path.endsWith('/close')
            ? { version: 9, previous_state: 'OPEN', active_binding: null }
            : {},
        ),
      });
    };
    const adapter = new FleetNodeEnrollmentGateHttpAdapter(
      new FleetHttpClient(config, execute, () => Promise.resolve()),
    );
    const gate = await adapter.closeEnrollmentGate({
      nodeId: 'node-1',
      operationId: 'node-op-1',
      actor,
    });
    await adapter.completeEnrollmentGate({ gate, state: 'OPEN', actor });

    expect(calls[1].body).toEqual({
      schema_version: 1,
      operation_id: 'node-op-1',
      version: 9,
      state: 'OPEN',
    });
  });
});

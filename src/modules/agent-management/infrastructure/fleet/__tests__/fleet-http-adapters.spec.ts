import type { FleetActorContext } from '../../../application/fleet/fleet.types';
import { FleetProtocolError } from '../../../application/fleet/errors/fleet-errors';
import type {
  FleetHttpConfig,
  FleetHttpExecutor,
  FleetHttpRequest,
  FleetHttpResponse,
} from '../fleet-http-client';
import { FleetHttpClient } from '../fleet-http-client';
import { FleetInvitationHttpAdapter } from '../fleet-invitation.http-adapter';
import { FleetInstallationHttpAdapter } from '../fleet-installation.http-adapter';

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
  test('creates with verified actor, stable operation ID, and idempotency key', async () => {
    const { client, calls } = makeAdapter(
      {
        invitation_id: 'invite-1',
        operation_id: 'op-1',
        node_id: 'node-1',
        status: 'PENDING',
        expires_at: '2026-11-22T00:10:00.000Z',
        invitation_token: 'one-time-secret',
      },
      201,
    );
    const adapter = new FleetInvitationHttpAdapter(client);

    await expect(
      adapter.create({
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
    expect(calls[0].url.pathname).toBe('/internal/v1/enrollment-invitations');
    expect(calls[0].request).toMatchObject({
      operationId: 'op-1',
      idempotencyKey: 'same-key',
      actor,
      body: { schema_version: 1, operation_id: 'op-1', node_id: 'node-1' },
    });
  });

  test('does not expose a secret for redeemed, cancelled, or expired invitations', async () => {
    for (const status of ['REDEEMED', 'CANCELLED', 'EXPIRED'] as const) {
      const payload = {
        invitation_id: 'invite-1',
        operation_id: 'op-1',
        node_id: 'node-1',
        status,
        expires_at: '2026-11-22T00:10:00.000Z',
        ...(status === 'REDEEMED' ? { installation_id: 'install-1' } : {}),
      };
      const { client } = makeAdapter(payload);
      const result = await new FleetInvitationHttpAdapter(
        client,
      ).getByOperation({
        operationId: 'op-1',
        actor,
      });
      expect(result).toMatchObject({ status });
      expect(result).not.toHaveProperty('invitationToken');
    }
  });

  test('rejects terminal replay that includes a stale invitation secret', async () => {
    const { client } = makeAdapter({
      invitation_id: 'invite-1',
      operation_id: 'op-1',
      node_id: 'node-1',
      status: 'EXPIRED',
      expires_at: '2026-11-22T00:10:00.000Z',
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

describe('Fleet installation HTTP adapter', () => {
  test('uses the gate operation owner and version for compare-and-complete', async () => {
    const calls: FleetHttpRequest[] = [];
    const execute: FleetHttpExecutor = (_url, request) => {
      calls.push(request);
      return Promise.resolve({
        status: 200,
        headers: {},
        body: JSON.stringify(
          request.path.endsWith('/close')
            ? { version: 9, previous_state: 'OPEN' }
            : {},
        ),
      });
    };
    const adapter = new FleetInstallationHttpAdapter(
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

  test('sends revoke retries under the same operation ID', async () => {
    const calls: FleetHttpRequest[] = [];
    const execute: FleetHttpExecutor = (_url, request) => {
      calls.push(request);
      return Promise.resolve({ status: 204, headers: {}, body: '' });
    };
    const adapter = new FleetInstallationHttpAdapter(
      new FleetHttpClient(config, execute, () => Promise.resolve()),
    );
    await adapter.revoke({
      installationId: 'install-1',
      operationId: 'revoke-op-1',
      actor,
    });
    expect(calls[0]).toMatchObject({
      operationId: 'revoke-op-1',
      path: 'installations/install-1/revoke',
      actor,
    });
  });
});

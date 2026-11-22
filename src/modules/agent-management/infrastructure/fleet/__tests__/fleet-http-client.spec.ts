import {
  FleetHttpClient,
  createFleetHttpsAgent,
  createFleetRequestHeaders,
  type FleetHttpConfig,
  type FleetHttpExecutor,
  type FleetHttpRequest,
  type FleetHttpResponse,
} from '../fleet-http-client';
import {
  FleetProtocolError,
  FleetUnavailableError,
} from '../../../application/fleet/errors/fleet-errors';

const config: FleetHttpConfig = {
  baseUrl: 'https://fleet.example.test/internal/v1/',
  clientCertificate: 'test-certificate',
  clientKey: 'test-private-key',
  timeoutMs: 3_000,
  maxRetries: 2,
  maxResponseBytes: 8_192,
  maxRetryDelayMs: 1_000,
};

const request: FleetHttpRequest = {
  method: 'POST',
  path: '/enrollment-invitations',
  actor: { actorId: 'user-1', requestId: 'request-1' },
  operationId: 'operation-1',
  idempotencyKey: 'key-1',
  body: { node_id: 'node-1', invitation_token: 'must-not-appear-in-errors' },
};

function response(
  status: number,
  body = '{"ok":true}',
  headers: Record<string, string | undefined> = {},
): FleetHttpResponse {
  return { status, body, headers };
}

describe('FleetHttpClient', () => {
  test('uses mTLS service identity and trusted actor/request/operation headers', () => {
    const agent = createFleetHttpsAgent(config);
    expect(agent.options).toMatchObject({
      cert: config.clientCertificate,
      key: config.clientKey,
      rejectUnauthorized: true,
    });
    agent.destroy();
    expect(
      createFleetRequestHeaders(request, JSON.stringify(request.body)),
    ).toMatchObject({
      'x-arimms-actor-id': 'user-1',
      'x-arimms-request-id': 'request-1',
      'x-arimms-operation-id': 'operation-1',
      'idempotency-key': 'key-1',
      'content-type': 'application/json',
    });
  });

  test('preserves operation and actor context across a 429 retry', async () => {
    const execute = jest
      .fn<Promise<FleetHttpResponse>, Parameters<FleetHttpExecutor>>()
      .mockResolvedValueOnce(response(429, '', { 'retry-after': '0' }))
      .mockResolvedValueOnce(response(201));
    const client = new FleetHttpClient(config, execute, () =>
      Promise.resolve(),
    );

    await expect(client.request(request)).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][1]).toEqual(request);
    expect(execute.mock.calls[1][1]).toEqual(request);
  });

  test('uses bounded fallback delay when 429 has no Retry-After', async () => {
    const execute = jest
      .fn<Promise<FleetHttpResponse>, Parameters<FleetHttpExecutor>>()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(201));
    const delay = jest.fn(() => Promise.resolve());
    const client = new FleetHttpClient(config, execute, delay);

    await client.request(request);
    expect(delay).toHaveBeenCalledWith(100);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  test('does not retry a permanent client error and does not expose its body', async () => {
    const execute = jest
      .fn<Promise<FleetHttpResponse>, Parameters<FleetHttpExecutor>>()
      .mockResolvedValue(response(400, 'must-not-appear-in-errors'));
    const client = new FleetHttpClient(config, execute, () =>
      Promise.resolve(),
    );

    await expect(client.request(request)).rejects.toBeInstanceOf(
      FleetProtocolError,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(client.request(request)).rejects.not.toThrow(
      'must-not-appear-in-errors',
    );
  });

  test('rejects redirects instead of forwarding credentials to another host', async () => {
    const execute = jest
      .fn<Promise<FleetHttpResponse>, Parameters<FleetHttpExecutor>>()
      .mockResolvedValue(
        response(302, '', { location: 'https://other.test/' }),
      );
    const client = new FleetHttpClient(config, execute, () =>
      Promise.resolve(),
    );

    await expect(client.request(request)).rejects.toBeInstanceOf(
      FleetProtocolError,
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('reports unknown mutation outcome after bounded transport retries', async () => {
    const execute = jest
      .fn<Promise<FleetHttpResponse>, Parameters<FleetHttpExecutor>>()
      .mockRejectedValue(new Error('socket closed after commit'));
    const client = new FleetHttpClient(config, execute, () =>
      Promise.resolve(),
    );

    await expect(client.request(request)).rejects.toMatchObject({
      name: FleetUnavailableError.name,
      outcomeUnknown: true,
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  test('does not retry a 429 when Retry-After exceeds the retry budget', async () => {
    const execute = jest
      .fn<Promise<FleetHttpResponse>, Parameters<FleetHttpExecutor>>()
      .mockResolvedValue(response(429, '', { 'retry-after': '3600' }));
    const delay = jest.fn(() => Promise.resolve());
    const client = new FleetHttpClient(config, execute, delay);

    await expect(client.request(request)).rejects.toBeInstanceOf(
      FleetUnavailableError,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  test('rejects invalid JSON without forwarding the response body', async () => {
    const execute = jest
      .fn<Promise<FleetHttpResponse>, Parameters<FleetHttpExecutor>>()
      .mockResolvedValue(response(200, 'secret response body'));
    const client = new FleetHttpClient(config, execute, () =>
      Promise.resolve(),
    );

    await expect(client.request(request)).rejects.toBeInstanceOf(
      FleetProtocolError,
    );
  });

  test('rejects oversized responses without retrying them as transport failures', async () => {
    const execute = jest
      .fn<Promise<FleetHttpResponse>, Parameters<FleetHttpExecutor>>()
      .mockResolvedValue(
        response(200, 'x'.repeat(config.maxResponseBytes + 1)),
      );
    const client = new FleetHttpClient(config, execute, () =>
      Promise.resolve(),
    );

    await expect(client.request(request)).rejects.toBeInstanceOf(
      FleetProtocolError,
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

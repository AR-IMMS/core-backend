import { createServer, type Server, type RequestListener } from 'node:http';
import { ZammadUserAccessAdapter } from './zammad-user-access.adapter';
describe('external access over HTTP to fake Zammad (contract)', () => {
  let server: Server;
  let adapter: ZammadUserAccessAdapter;
  let handler: RequestListener;
  let requests: string[];
  beforeEach(async () => {
    requests = [];
    handler = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: req.url?.endsWith('/me') ? 6 : 4,
          active: true,
          group_ids: { '42': ['full'] },
        }),
      );
    };
    server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      expect(req.headers.authorization).toBe('Token token=fake-secret');
      handler(req, res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No fake port');
    adapter = new ZammadUserAccessAdapter(
      {
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiToken: 'fake-secret',
        expectedGroupId: 42,
        timeoutMs: 300,
      },
      { serviceUserId: 6, excludedHumanUserIds: [1, 7] },
    );
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  it('reads service identity followed by exact human identity using only GET', async () => {
    await expect(adapter.getEligibleHuman(4)).resolves.toEqual({
      externalUserId: 4,
      groupId: 42,
    });
    expect(requests).toEqual(['GET /api/v1/users/me', 'GET /api/v1/users/4']);
  });
  it.each([
    [401, 'UPSTREAM_ACCESS_DENIED'],
    [403, 'UPSTREAM_ACCESS_DENIED'],
    [500, 'UPSTREAM_UNAVAILABLE'],
    [429, 'UPSTREAM_UNAVAILABLE'],
    [302, 'UNEXPECTED_UPSTREAM_STATUS'],
  ] as const)(
    'fails closed on service HTTP %s without retry or redirect',
    async (status, code) => {
      handler = (_req, res) => {
        res.writeHead(status, { location: '/other' });
        res.end('private upstream data fake-secret');
      };
      await expect(adapter.getEligibleHuman(4)).rejects.toMatchObject({ code });
      expect(requests).toHaveLength(1);
    },
  );
  it('handles missing human as ineligible', async () => {
    const original = handler;
    handler = (req, res) => {
      if (req.url?.endsWith('/4')) {
        res.writeHead(404);
        res.end();
      } else original(req, res);
    };
    await expect(adapter.getEligibleHuman(4)).resolves.toBeNull();
  });
  it('handles missing service as dependency identity failure', async () => {
    handler = (_req, res) => {
      res.writeHead(404);
      res.end();
    };
    await expect(adapter.getEligibleHuman(4)).rejects.toMatchObject({
      code: 'SERVICE_IDENTITY_MISMATCH',
    });
  });
  it('times out without retry', async () => {
    handler = () => {};
    await expect(adapter.getEligibleHuman(4)).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
    });
    expect(requests).toHaveLength(1);
  });
  it('sanitizes connection termination', async () => {
    handler = (req) => req.socket.destroy();
    await expect(adapter.getEligibleHuman(4)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
  });
  it('rejects malformed human body after valid service response', async () => {
    const original = handler;
    handler = (req, res) => {
      if (req.url?.endsWith('/4')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{private malformed');
      } else original(req, res);
    };
    await expect(adapter.getEligibleHuman(4)).rejects.toMatchObject({
      code: 'INVALID_UPSTREAM_RESPONSE',
    });
  });
});

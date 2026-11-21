import { createServer, type RequestListener, type Server } from 'node:http';
import type { TicketReadPort } from '../application/ticket-read.port';
import { ZammadTicketReadAdapter } from './zammad-ticket-read.adapter';

const fixture = {
  id: 17,
  number: '11017',
  title: 'HTTP fixture',
  group_id: 42,
  owner_id: 5,
  customer_id: 7,
  state_id: 2,
  priority_id: 2,
  created_at: '2026-11-12T01:00:00.000Z',
  updated_at: '2026-11-12T02:00:00.000Z',
};

describe('Zammad read over real HTTP to a fake server (contract)', () => {
  let server: Server;
  let adapter: TicketReadPort;
  let baseUrl: string;
  let handler: RequestListener;
  let requests: { method?: string; url?: string; authorization?: string }[];

  beforeEach(async () => {
    requests = [];
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(fixture));
    };
    server = createServer((req, res) => {
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
      });
      handler(req, res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No fake port');
    baseUrl = `http://127.0.0.1:${address.port}`;
    adapter = new ZammadTicketReadAdapter({
      baseUrl,
      apiToken: 'fake-test-token',
      expectedGroupId: 42,
      timeoutMs: 2000,
    });
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('sends one scoped GET with the credential only in its header', async () => {
    await expect(adapter.getTicket(17)).resolves.toMatchObject({
      externalTicketId: 17,
      groupId: 42,
      nativeOwnerId: 5,
    });
    expect(requests).toEqual([
      {
        method: 'GET',
        url: '/api/v1/tickets/17',
        authorization: 'Token token=fake-test-token',
      },
    ]);
  });

  it('returns null for a real HTTP 404', async () => {
    handler = (_req, res) => {
      res.writeHead(404);
      res.end('private upstream data');
    };
    await expect(adapter.getTicket(17)).resolves.toBeNull();
    expect(requests).toHaveLength(1);
  });

  it('returns no Ticket from a different group', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...fixture, group_id: 99 }));
    };
    await expect(adapter.getTicket(17)).resolves.toBeNull();
  });

  it.each([
    [401, 'UPSTREAM_ACCESS_DENIED'],
    [403, 'UPSTREAM_ACCESS_DENIED'],
    [500, 'UPSTREAM_UNAVAILABLE'],
    [503, 'UPSTREAM_UNAVAILABLE'],
    [429, 'UPSTREAM_UNAVAILABLE'],
    [400, 'UNEXPECTED_UPSTREAM_STATUS'],
  ])('sanitizes HTTP %i and does not retry', async (status, code) => {
    handler = (_req, res) => {
      res.writeHead(status);
      res.end('fake-test-token and private upstream data');
    };
    await expect(adapter.getTicket(17)).rejects.toMatchObject({
      code,
      message: `Ticket read failed: ${code}`,
    });
    expect(requests).toHaveLength(1);
  });

  it.each([301, 302, 307, 308])(
    'does not follow a %i redirect or forward credentials',
    async (status) => {
      handler = (_req, res) => {
        res.writeHead(status, { Location: `${baseUrl}/credential-trap` });
        res.end();
      };
      await expect(adapter.getTicket(17)).rejects.toMatchObject({
        code: 'UNEXPECTED_UPSTREAM_STATUS',
      });
      expect(requests.map((r) => r.url)).toEqual(['/api/v1/tickets/17']);
    },
  );

  it.each([
    ['application/json', '{broken JSON'],
    ['text/html', '<html>login page</html>'],
    ['application/json', '[]'],
    ['application/json', JSON.stringify({ ...fixture, id: 18 })],
  ])('rejects unexpected content %#', async (contentType, body) => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(body);
    };
    await expect(adapter.getTicket(17)).rejects.toMatchObject({
      code: 'INVALID_UPSTREAM_RESPONSE',
    });
  });

  it.each(['headers', 'body'])('bounds time waiting for %s', async (stage) => {
    handler = (_req, res) => {
      if (stage === 'body') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{');
      }
    };
    const timedAdapter = new ZammadTicketReadAdapter({
      baseUrl,
      apiToken: 'fake-test-token',
      expectedGroupId: 42,
      timeoutMs: 100,
    });
    await expect(timedAdapter.getTicket(17)).rejects.toMatchObject({
      code: 'UPSTREAM_TIMEOUT',
    });
    expect(requests).toHaveLength(1);
  });

  it('sanitizes a disconnected upstream socket', async () => {
    handler = (req) => req.socket.destroy();
    await expect(adapter.getTicket(17)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
    expect(requests).toHaveLength(1);
  });

  it('sanitizes connection refusal', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(adapter.getTicket(17)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
    });
    // Start again so the shared teardown can close a listening server.
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
  });
  it.each([
    [4, 'reference'],
    [null, 'missing'],
    ['4', 'invalid'],
  ])(
    'reads the canonical Business Owner contract over HTTP: %j',
    async (value, kind) => {
      handler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...fixture, arimms_business_owner: value }));
      };
      expect((await adapter.getTicket(17))?.businessOwner.kind).toBe(kind);
    },
  );
});

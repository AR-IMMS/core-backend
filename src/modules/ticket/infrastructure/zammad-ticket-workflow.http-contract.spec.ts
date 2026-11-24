import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { ZammadTicketWorkflowAdapter } from './zammad-ticket-workflow.adapter';

async function server(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  timeoutMs = 1000,
) {
  const service = createServer(handler);
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
  const adapter = new ZammadTicketWorkflowAdapter(
    {
      baseUrl: `http://127.0.0.1:${(service.address() as AddressInfo).port}`,
      apiToken: 'fake-secret',
      expectedGroupId: 2,
      timeoutMs,
    },
    7,
  );
  return {
    adapter,
    close: () => {
      service.closeAllConnections();
      service.close();
    },
  };
}

describe('Zammad workflow HTTP contract', () => {
  it('projects only active priority metadata and resolves display color from upstream data rather than IDs', async () => {
    const fixture = await server((req, res) => {
      expect(req.url).toBe('/api/v1/ticket_priorities');
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify([
          { id: 41, name: '1 low', active: true, ui_color: 'low-priority' },
          { id: 4, name: '2 normal', active: true, ui_color: null },
          { id: 17, name: '3 high', active: true, ui_color: 'high-priority' },
          { id: 99, name: '4 critical', active: false, ui_color: null },
        ]),
      );
    });
    try {
      await expect(fixture.adapter.priorities()).resolves.toEqual([
        { id: 41, label: 'Low', color: 'green' },
        { id: 4, label: 'Normal', color: 'cyan' },
        { id: 17, label: 'High', color: 'amber' },
      ]);
    } finally {
      fixture.close();
    }
  });

  it.each([401, 403, 503])(
    'fails closed without retry after upstream status %d',
    async (status) => {
      let calls = 0;
      const fixture = await server((_req, res) => {
        calls++;
        res.writeHead(status).end();
      });
      try {
        await expect(
          fixture.adapter.update(31, { state_id: 2 }),
        ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
        expect(calls).toBe(1);
      } finally {
        fixture.close();
      }
    },
  );

  it.each(['timeout', 'connection loss'])(
    'does not retry Article append after %s',
    async (failure) => {
      let calls = 0;
      const fixture = await server((req) => {
        calls++;
        if (failure === 'connection loss') req.socket.destroy();
      }, 400);
      try {
        await expect(
          fixture.adapter.append(31, 'Internal note', 'receipt'),
        ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
        expect(calls).toBe(1);
      } finally {
        fixture.close();
      }
    },
  );

  it('rejects an Article response that identifies another Ticket', async () => {
    const fixture = await server((_req, res) => {
      res
        .writeHead(201, { 'Content-Type': 'application/json' })
        .end('{"id":42,"ticket_id":32}');
    });
    try {
      await expect(
        fixture.adapter.append(31, 'Internal note', 'receipt'),
      ).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
    } finally {
      fixture.close();
    }
  });
  it('sends a scoped create with independent responsibility and a silent note marker', async () => {
    let captured: unknown;
    let auth: string | undefined;
    let route: string | undefined;
    const fixture = await server((req, res) => {
      auth = req.headers.authorization;
      route = req.url;
      req.setEncoding('utf8').once('data', (chunk: string) => {
        captured = JSON.parse(chunk) as unknown;
      });
      req.once('end', () =>
        res
          .writeHead(201, { 'Content-Type': 'application/json' })
          .end('{"id":42}'),
      );
    });
    try {
      await expect(
        fixture.adapter.create({
          title: 'Test',
          ownerId: 4,
          assigneeId: 5,
          priorityId: 2,
          stateId: 1,
          body: 'Plain',
          marker: 'receipt',
        }),
      ).resolves.toBe(42);
      expect(route).toBe('/api/v1/tickets');
      expect(auth).toBe('Token token=fake-secret');
      expect(captured).toEqual({
        title: 'Test',
        group_id: 2,
        customer_id: 7,
        owner_id: 5,
        arimms_business_owner: 4,
        state_id: 1,
        priority_id: 2,
        article: {
          subject: 'AR-IMMS operation receipt',
          body: 'Plain',
          type: 'note',
          sender: 'Agent',
          content_type: 'text/plain',
          internal: true,
        },
      });
    } finally {
      fixture.close();
    }
  });

  it('constrains search and rejects non-monotonic results', async () => {
    let captured: URLSearchParams | undefined;
    const fixture = await server((req, res) => {
      captured = new URL(req.url ?? '', 'http://loopback').searchParams;
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end('[{"id":7},{"id":6}]');
    });
    try {
      await expect(
        fixture.adapter.search({ after: 4, limit: 4, visibleTo: 5 }),
      ).rejects.toMatchObject({ code: 'INVALID_UPSTREAM_RESPONSE' });
      expect(captured?.get('query')).toBe(
        'group_id:2 AND id:>4 AND (owner_id:5 OR arimms_business_owner:5)',
      );
    } finally {
      fixture.close();
    }
  });

  it('does not retry or follow a redirect after a mutation', async () => {
    let calls = 0;
    const fixture = await server((_req, res) => {
      calls++;
      res.writeHead(302, { Location: '/somewhere' }).end();
    });
    try {
      await expect(
        fixture.adapter.update(31, { owner_id: 5 }),
      ).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
      expect(calls).toBe(1);
    } finally {
      fixture.close();
    }
  });
});

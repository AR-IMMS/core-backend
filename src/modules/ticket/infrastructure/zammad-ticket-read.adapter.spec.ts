import { ZammadTicketReadAdapter } from './zammad-ticket-read.adapter';

const fixture = {
  id: 17,
  number: '11017',
  title: 'Read-only test',
  group_id: 42,
  owner_id: 5,
  customer_id: 7,
  state_id: 2,
  priority_id: 2,
  created_at: '2026-11-12T01:00:00.000Z',
  updated_at: '2026-11-12T02:00:00.000Z',
};

describe('Zammad Ticket read adapter (unit)', () => {
  const adapter = new ZammadTicketReadAdapter({
    baseUrl: 'https://zammad.example.test',
    apiToken: 'fake-test-token',
    expectedGroupId: 42,
    timeoutMs: 1000,
  });
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('maps only selected canonical fields without assigning Business Owner semantics', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ...fixture, article: { body: 'excluded' }, custom: 'x' }),
    );
    await expect(adapter.getTicket(17)).resolves.toEqual({
      externalTicketId: 17,
      number: '11017',
      title: 'Read-only test',
      groupId: 42,
      nativeOwnerId: 5,
      businessOwner: { kind: 'missing' },
      customerId: 7,
      stateId: 2,
      priorityId: 2,
      createdAt: fixture.created_at,
      updatedAt: fixture.updated_at,
    });
  });

  it.each([
    [4, { kind: 'reference', externalUserId: 4 }],
    [null, { kind: 'missing' }],
    ['4', { kind: 'invalid' }],
    [0, { kind: 'invalid' }],
    [2147483648, { kind: 'invalid' }],
    [{ id: 4 }, { kind: 'invalid' }],
  ])(
    'classifies canonical Business Owner without coercion: %j',
    async (value, expected) => {
      fetchMock.mockResolvedValue(
        Response.json({ ...fixture, arimms_business_owner: value }),
      );
      expect((await adapter.getTicket(17))?.businessOwner).toEqual(expected);
    },
  );

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid ID %s before network access',
    async (id) => {
      await expect(adapter.getTicket(id)).rejects.toMatchObject({
        code: 'INVALID_TICKET_ID',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { id: '17' },
    { id: 18 },
    { owner_id: null },
    { owner_id: Number.MAX_SAFE_INTEGER + 1 },
    { customer_id: -1 },
    { group_id: '42' },
    { state_id: 1.5 },
    { priority_id: undefined },
    { title: null },
    { number: 11017 },
    { created_at: 'yesterday' },
    { updated_at: undefined },
  ])('rejects malformed or mismatched fields %#', async (patch) => {
    fetchMock.mockResolvedValue(Response.json({ ...fixture, ...patch }));
    await expect(adapter.getTicket(17)).rejects.toMatchObject({
      code: 'INVALID_UPSTREAM_RESPONSE',
    });
  });

  it('does not interpret unassigned native owner or unknown state IDs', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ...fixture, owner_id: 1, state_id: 999 }),
    );
    await expect(adapter.getTicket(17)).resolves.toMatchObject({
      nativeOwnerId: 1,
      stateId: 999,
    });
  });

  it('returns no data for another group', async () => {
    fetchMock.mockResolvedValue(Response.json({ ...fixture, group_id: 43 }));
    await expect(adapter.getTicket(17)).resolves.toBeNull();
  });

  it('replaces transport exceptions without preserving secret-bearing causes', async () => {
    fetchMock.mockRejectedValue(
      new Error('fake-test-token in transport error'),
    );
    await expect(adapter.getTicket(17)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'Ticket read failed: UPSTREAM_UNAVAILABLE',
    });
    try {
      await adapter.getTicket(17);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('fake-test-token');
      expect(error).not.toHaveProperty('cause');
    }
  });
});

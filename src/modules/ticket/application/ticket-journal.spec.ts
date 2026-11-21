/* eslint-disable @typescript-eslint/require-await -- Promise-returning test doubles model journal ports. */
import type {
  OutboxWriterPort,
  UnitOfWorkContext,
  UnitOfWorkPort,
} from '@platform/events';
import {
  TicketJournal,
  TicketOperationError,
  type JournalResult,
  type TicketJournalStore,
  type TicketReceipt,
} from './ticket-journal';

const item = { ticketId: 31, changes: [] } satisfies JournalResult;
const intent = {
  actor: 'operator',
  instance: 'test',
  group: 2,
  key: 'test-operation',
  action: 'created',
  payload: { title: 'Fixture' },
};

function setup() {
  const rows = new Map<string, TicketReceipt>();
  const store: TicketJournalStore = {
    find: jest.fn(async (id) => rows.get(id) ?? null),
    claim: jest.fn(async (receipt) => {
      const old = rows.get(receipt.id);
      if (old) return old;
      if (
        receipt.lock &&
        [...rows.values()].some((row) => row.lock === receipt.lock)
      )
        throw new TicketOperationError('CONFLICT');
      rows.set(receipt.id, receipt);
      return null;
    }),
    verify: jest.fn(async (id, result) => {
      const row = rows.get(id);
      if (!row || row.stage !== 'dispatching') throw new Error();
      rows.set(id, { ...row, stage: 'verified', result });
    }),
    fail: jest.fn(async (id) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, stage: 'failed', lock: undefined });
    }),
    complete: jest.fn(async (id) => {
      const row = rows.get(id);
      if (row?.stage !== 'verified') return false;
      rows.set(id, { ...row, stage: 'succeeded', lock: undefined });
      return true;
    }),
    nextSequence: jest.fn(async () => 1),
    putLinks: jest.fn(async () => undefined),
    links: jest.fn(async () => null),
  };
  const uow: UnitOfWorkPort = {
    async run(work) {
      const snapshot = new Map(rows);
      try {
        return await work({} as UnitOfWorkContext);
      } catch (error) {
        rows.clear();
        for (const [id, row] of snapshot) rows.set(id, row);
        throw error;
      }
    },
  };
  const append = jest
    .fn<
      ReturnType<OutboxWriterPort['append']>,
      Parameters<OutboxWriterPort['append']>
    >()
    .mockResolvedValue(undefined);
  return {
    store,
    append,
    make: () => new TicketJournal(store, uow, { append }),
  };
}

describe('Ticket operation receipts', () => {
  it('dispatches once, rejects conflicting reuse and audits once', async () => {
    const state = setup();
    const send = jest.fn(async () => item);
    const journal = state.make();
    const prepare = async () => send;
    await expect(journal.run(intent, prepare)).resolves.toEqual(item);
    await expect(state.make().run(intent, prepare)).resolves.toEqual(item);
    await expect(
      journal.run({ ...intent, payload: { title: 'Other' } }, prepare),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.append).toHaveBeenCalledTimes(1);
    expect(state.append.mock.calls[0][0].payload).toMatchObject({
      actor: { type: 'user', id: 'operator' },
    });
  });

  it('cannot dispatch after a lost response and can recover delayed positive evidence', async () => {
    const state = setup();
    const send = jest.fn(async () => {
      throw new Error('response lost');
    });
    await expect(
      state.make().run(intent, async () => send),
    ).rejects.toMatchObject({ code: 'UNRESOLVED' });
    await expect(
      state.make().run(
        intent,
        async () => send,
        async () => {
          throw new Error('not indexed');
        },
      ),
    ).rejects.toMatchObject({ code: 'UNRESOLVED' });
    await expect(
      state.make().run(
        { ...intent, reconcileOnly: true },
        async () => send,
        async () => item,
      ),
    ).resolves.toEqual(item);
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.append).toHaveBeenCalledTimes(1);
  });

  it('recovers the verified reference after local context/Audit commit fails', async () => {
    const state = setup();
    state.append.mockRejectedValueOnce(new Error('local failure'));
    const send = jest.fn(async () => ({
      ...item,
      links: { incidentId: null, assetIds: [], maintenanceIds: [] },
    }));
    await expect(
      state.make().run(intent, async () => send),
    ).rejects.toMatchObject({ code: 'UNRESOLVED' });
    await expect(
      state.make().run(intent, async () => send),
    ).resolves.toMatchObject({ ticketId: 31 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps other Core writers out while a responsibility mutation is unresolved', async () => {
    const state = setup();
    const send = jest.fn(async () => {
      throw new Error('ambiguous write');
    });
    await expect(
      state.make().run({ ...intent, ticketId: 31 }, async () => send),
    ).rejects.toMatchObject({ code: 'UNRESOLVED' });
    await expect(
      state
        .make()
        .run(
          { ...intent, ticketId: 31, actor: 'other', key: 'another-operation' },
          async () => send,
        ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when request is rejected before sending', async () => {
    const state = setup();
    const before = { ...intent, ticketId: 31 };
    await expect(
      state.make().run(before, async () => {
        throw new TicketOperationError('DENIED');
      }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      state
        .make()
        .run(
          { ...before, key: 'another-operation' },
          async () => async () => item,
        ),
    ).resolves.toEqual(item);
  });
});

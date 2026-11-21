import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'mongoose';
import type {
  BusinessFactEnvelope,
  OutboxWriterPort,
} from '../src/platform/events';
import { MongoUnitOfWork } from '../src/platform/events/infrastructure/mongodb/mongo-unit-of-work';
import { TicketJournal } from '../src/modules/ticket/application/ticket-journal';
import { MongoTicketJournalStore } from '../src/modules/ticket/infrastructure/mongodb/mongo-ticket-journal.store';
import { resolveMongoTestConfig } from './mongodb-test-config';

async function run() {
  const config = resolveMongoTestConfig();
  const connection = await createConnection(config.uri, {
    serverSelectionTimeoutMS: 5000,
  }).asPromise();
  const instance = `ticket-journal-test-${randomUUID()}`;
  const db = connection.getClient().db(connection.name);
  const facts = db.collection<{ instance: string; fact: BusinessFactEnvelope }>(
    'ticket_journal_test_facts',
  );
  try {
    const store = new MongoTicketJournalStore(connection);
    await store.initialize();
    const uow = new MongoUnitOfWork(connection);
    let fail = true;
    const outbox: OutboxWriterPort = {
      async append(fact, context) {
        if (fail) throw new Error('synthetic local Audit failure');
        const session = context as unknown as Awaited<
          ReturnType<typeof connection.startSession>
        >;
        await facts.insertOne({ instance, fact }, { session });
      },
    };
    const input = {
      actor: 'synthetic',
      instance,
      group: 2,
      action: 'created',
      key: randomUUID(),
      payload: { title: 'test' },
    };
    const result = {
      ticketId: 77,
      links: {
        incidentId: 'confirmed-test',
        assetIds: ['asset-1', 'asset-2'],
        maintenanceIds: [],
      },
      changes: [],
    };
    let calls = 0;
    const prepare = () =>
      Promise.resolve(() => {
        calls++;
        return Promise.resolve(result);
      });
    await assert.rejects(
      new TicketJournal(store, uow, outbox).run(input, prepare),
      { code: 'UNRESOLVED' },
    );
    assert.equal(await store.links(instance, 2, 77), null);
    assert.equal(await facts.countDocuments({ instance }), 0);
    fail = false;
    const recoveredStore = new MongoTicketJournalStore(connection);
    const recovered = new TicketJournal(recoveredStore, uow, outbox);
    assert.deepEqual(await recovered.run(input, prepare), result);
    assert.deepEqual(await recoveredStore.links(instance, 2, 77), result.links);
    assert.equal(calls, 1);
    assert.equal(await facts.countDocuments({ instance }), 1);
    await recovered.run(input, prepare);
    assert.equal(await facts.countDocuments({ instance }), 1);
    console.log(
      'PASS physical replica-set checkpoint rollback, restart recovery, context and Audit atomicity',
    );

    const update = {
      ...input,
      key: randomUUID(),
      ticketId: 77,
      action: 'closed',
    };
    let begin!: () => void;
    const entered = new Promise<void>((resolve) => {
      begin = resolve;
    });
    let end!: () => void;
    const waiting = new Promise<void>((resolve) => {
      end = resolve;
    });
    const running = recovered.run(update, () =>
      Promise.resolve(async () => {
        begin();
        await waiting;
        return { ticketId: 77, changes: [] };
      }),
    );
    try {
      await entered;
      await assert.rejects(
        new TicketJournal(store, uow, outbox).run(
          { ...update, key: randomUUID(), actor: 'concurrent' },
          prepare,
        ),
        { code: 'CONFLICT' },
      );
    } finally {
      end();
    }
    await running;
    const sequences = (
      await facts
        .find({ instance })
        .sort({ 'fact.resource.sequence': 1 })
        .toArray()
    ).map(({ fact }) => fact.resource.sequence);
    assert.deepEqual(sequences, [1, 2]);
    console.log(
      'PASS cross-instance lock contention and monotonic per-Ticket Audit sequence',
    );
  } finally {
    await db.collection('ticket_operation_receipts').deleteMany({ instance });
    await db.collection('ticket_business_contexts').deleteMany({ instance });
    await facts.deleteMany({ instance });
    await connection.close();
  }
}

void run().catch(() => {
  console.error('Ticket journal Mongo integration failed (details withheld)');
  process.exitCode = 1;
});

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
      notification: { kind: 'created' as const, recipients: [4, 5] },
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
    const recipient = {
      instance,
      group: 2,
      externalUserId: 5,
      actor: 'recipient',
    };
    assert.deepEqual(await store.notificationCandidates(recipient, 20), []);
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
    const inbox = await store.notificationCandidates(recipient, 20);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].read, false);
    assert.equal(
      (
        await store.notificationCandidates(
          { ...recipient, externalUserId: 6 },
          20,
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await store.notificationCandidates(
          { ...recipient, actor: 'synthetic' },
          20,
        )
      ).length,
      0,
    );
    assert.equal(
      (await store.notificationCandidates({ ...recipient, group: 3 }, 20))
        .length,
      0,
    );
    assert.equal(
      await store.markNotificationsRead(recipient, [inbox[0].id]),
      1,
    );
    assert.equal(
      await store.markNotificationsRead(recipient, [inbox[0].id]),
      0,
    );
    assert.equal(
      (await store.notificationCandidates(recipient, 20))[0].read,
      true,
    );
    assert.equal(
      (
        await store.notificationCandidates(
          { ...recipient, externalUserId: 4, actor: 'other-recipient' },
          20,
        )
      )[0].read,
      false,
    );
    console.log(
      'PASS notification visibility after commit, replay deduplication and per-recipient read persistence',
    );
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

    const archivedInput = {
      ...input,
      ticketId: 77,
      key: randomUUID(),
      action: 'archived',
      payload: { reason: 'fixture' },
    };
    const archive = {
      instance,
      group: 2,
      ticketId: 77,
      active: true,
      version: 1,
      archivedAt: new Date().toISOString(),
      archivedByUserId: 'synthetic',
      archiveReason: 'fixture',
    };
    const archiveCheckpoint = {
      ticketId: 77,
      archive,
      changes: [
        { field: 'archived', before: false, after: true },
        { field: 'reason', after: 'fixture' },
      ],
    };
    const archivePrepare = () =>
      Promise.resolve(() => Promise.resolve(archiveCheckpoint));
    const evidence = {
      instance,
      group: 2,
      ticketId: 77,
      id: randomUUID(),
      fileName: 'fixture.pdf',
      mimeType: 'application/pdf',
      fileSize: 30,
      uploadedByUserId: 'synthetic',
      createdAt: archive.archivedAt,
      sha256: '9'.repeat(64),
    };
    const evidenceInput = {
      ...input,
      key: randomUUID(),
      ticketId: 77,
      action: 'evidence_added',
      payload: { id: evidence.id },
    };
    const evidenceResult = { ticketId: 77, evidence, changes: [] };
    const evidencePrepare = () =>
      Promise.resolve(() => Promise.resolve(evidenceResult));
    await recovered.run(evidenceInput, evidencePrepare);
    await recovered.run(evidenceInput, evidencePrepare);
    fail = true;
    let markArchiveDispatch!: () => void;
    const archiveDispatching = new Promise<void>((resolve) => {
      markArchiveDispatch = resolve;
    });
    let releaseArchive!: () => void;
    const archiveHeld = new Promise<void>((resolve) => {
      releaseArchive = resolve;
    });
    const archiveRetry = new TicketJournal(store, uow, outbox).run(
      archivedInput,
      () =>
        Promise.resolve(async () => {
          markArchiveDispatch();
          await archiveHeld;
          return archiveCheckpoint;
        }),
    );
    try {
      await Promise.race([archiveDispatching, archiveRetry]);
      await assert.rejects(
        recovered.run(
          { ...archivedInput, key: randomUUID(), action: 'restored' },
          () => Promise.reject(new Error('Restore must not acquire this lock')),
        ),
        { code: 'CONFLICT' },
      );
    } finally {
      releaseArchive();
      await assert.rejects(archiveRetry, { code: 'UNRESOLVED' });
    }
    assert.equal(await store.archive(instance, 2, 77), null);
    fail = false;
    await recovered.run(archivedInput, archivePrepare);
    await recovered.run(archivedInput, archivePrepare);
    assert.equal((await store.archived(instance, 2, 0, 1))[0]?.ticketId, 77);
    assert.equal(
      await facts.countDocuments({
        instance,
        'fact.payload.action': 'ticket.archived',
      }),
      1,
    );
    const restored = {
      ...archive,
      version: 2,
      active: false,
      restoredAt: archive.archivedAt,
      restoredByUserId: 'synthetic',
      restoreReason: 'fixture restore',
    };
    await recovered.run(
      { ...archivedInput, key: randomUUID(), action: 'restored' },
      () =>
        Promise.resolve(() =>
          Promise.resolve({ ticketId: 77, archive: restored, changes: [] }),
        ),
    );
    assert.equal((await store.archive(instance, 2, 77))?.active, false);
    assert.deepEqual(
      (await store.listEvidence(instance, 2, 77, '', 20)).map((row) => row.id),
      [evidence.id],
    );
    assert.equal(
      await facts.countDocuments({
        instance,
        'fact.payload.action': 'ticket.evidence_added',
      }),
      1,
    );
    console.log(
      'PASS archive Audit rollback, same-key replay, restore contention and Evidence retention',
    );
  } finally {
    await db.collection('ticket_archives').deleteMany({ instance });
    await db.collection('ticket_evidence').deleteMany({ instance });
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

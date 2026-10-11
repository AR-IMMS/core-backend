import assert from 'node:assert/strict';
import {
  createConnection,
  Schema,
  type ClientSession,
  type Model,
} from 'mongoose';

import { AuditEventConsumer } from '@modules/audit/application/audit-event.consumer';
import {
  AUDIT_RECORD_MODEL,
  AuditRecordSchema,
} from '@modules/audit/infrastructure/mongodb/audit-record.schema';
import type { AuditRecord } from '@modules/audit/domain/audit-record';
import { MongoAuditRecordStore } from '@modules/audit/infrastructure/mongodb/mongo-audit-record.store';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION,
  type AuditFact,
} from '@platform/events';
import { EventConsumerRegistry } from '@platform/events/application/event-consumer.registry';
import { OutboxRelayService } from '@platform/events/application/outbox-relay.service';
import {
  OUTBOX_ENTRY_MODEL,
  OutboxEntrySchema,
} from '@platform/events/infrastructure/mongodb/outbox.schema';
import {
  MongoOutboxStore,
  type MongoOutboxModel,
} from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import { MongoUnitOfWork } from '@platform/events/infrastructure/mongodb/mongo-unit-of-work';
import { resolveMongoTestConfig } from './mongodb-test-config';

interface BusinessWrite {
  readonly eventId: string;
}

const BUSINESS_WRITE_MODEL = 'Pe006BusinessWrite';
const BUSINESS_WRITE_SCHEMA = new Schema<BusinessWrite>(
  { eventId: { type: String, required: true } },
  { collection: 'pe006_business_writes' },
);
const AUDIT_SUBSCRIPTION = {
  eventType: AUDIT_FACT_EVENT_TYPE,
  eventVersion: AUDIT_FACT_EVENT_VERSION,
};

async function main(): Promise<void> {
  const { uri, dbName } = resolveMongoTestConfig();
  const connection = await createConnection(uri, {
    dbName,
    serverSelectionTimeoutMS: 5_000,
  }).asPromise();

  try {
    await connection.dropDatabase();
    const businessWrites = connection.model<BusinessWrite>(
      BUSINESS_WRITE_MODEL,
      BUSINESS_WRITE_SCHEMA,
    );
    const outboxModel = connection.model(OUTBOX_ENTRY_MODEL, OutboxEntrySchema);
    const auditModel = connection.model<AuditRecord>(
      AUDIT_RECORD_MODEL,
      AuditRecordSchema,
    );
    await Promise.all([outboxModel.init(), auditModel.init()]);
    const clearCollections = async (): Promise<void> => {
      await Promise.all([
        businessWrites.deleteMany({}),
        outboxModel.deleteMany({}),
        auditModel.deleteMany({}),
      ]);
    };

    const outbox = new MongoOutboxStore(
      outboxModel as unknown as MongoOutboxModel,
    );
    const auditRecords = auditModel as unknown as Model<AuditRecord>;
    const unitOfWork = new MongoUnitOfWork(connection);

    await clearCollections();
    await runCase('commit and Audit delivery', async () => {
      const event = auditFact('pe006-commit');
      await unitOfWork.run(async (context) => {
        await businessWrites.create([{ eventId: event.event_id }], {
          session: context as ClientSession,
        });
        await outbox.append(event, context);
      });
      const consumer = new AuditEventConsumer(
        new MongoAuditRecordStore(auditRecords),
      );
      const relay = new OutboxRelayService(
        outbox,
        new EventConsumerRegistry([consumer]),
      );
      assert.deepEqual(await relay.runOnce(), {
        claimed: 1,
        delivered: 1,
        failed: 0,
      });
      assert.equal(
        await businessWrites.countDocuments({ eventId: event.event_id }),
        1,
      );
      assert.equal(
        await auditRecords.countDocuments({ eventId: event.event_id }),
        1,
      );
    });

    await clearCollections();
    await runCase('atomic rollback', async () => {
      const event = auditFact('pe006-rollback');
      await assert.rejects(
        unitOfWork.run(async (context) => {
          await businessWrites.create([{ eventId: event.event_id }], {
            session: context as ClientSession,
          });
          await outbox.append(event, context);
          throw new Error('simulated producer failure');
        }),
        /simulated producer failure/,
      );
      assert.equal(
        await businessWrites.countDocuments({ eventId: event.event_id }),
        0,
      );
      assert.equal(await outboxCountByEvent(connection, event.event_id), 0);
    });

    await clearCollections();
    await runCase('per-resource sequence order', async () => {
      const events = [
        auditFact('pe006-order-1', 1, 'resource-order'),
        auditFact('pe006-order-2', 2, 'resource-order'),
      ];
      await unitOfWork.run(async (context) => {
        for (const event of events) await outbox.append(event, context);
      });
      const receivedSequences: number[] = [];
      const consumer = {
        consumerId: 'sequence-recorder',
        subscriptions: [AUDIT_SUBSCRIPTION],
        handle(event: AuditFact): void {
          receivedSequences.push(event.resource.sequence);
        },
      };
      const relay = new OutboxRelayService(
        outbox,
        new EventConsumerRegistry([consumer]),
      );
      assert.deepEqual(await relay.runOnce(), {
        claimed: 1,
        delivered: 1,
        failed: 0,
      });
      assert.deepEqual(await relay.runOnce(), {
        claimed: 1,
        delivered: 1,
        failed: 0,
      });
      assert.deepEqual(receivedSequences, [1, 2]);
    });

    await clearCollections();
    await runCase('independent consumer progress and retry', async () => {
      const event = auditFact('pe006-independent-progress');
      await unitOfWork.run((context) => outbox.append(event, context));
      const firstClaim = await outbox.claimEligibleDeliveries({
        now: new Date(),
        limit: 10,
        consumerId: 'consumer-a',
        subscriptions: [AUDIT_SUBSCRIPTION],
      });
      assert.equal(firstClaim.length, 1);
      await outbox.markDelivered(firstClaim[0], new Date());
      const secondClaim = await outbox.claimEligibleDeliveries({
        now: new Date(),
        limit: 10,
        consumerId: 'consumer-b',
        subscriptions: [AUDIT_SUBSCRIPTION],
      });
      assert.equal(secondClaim.length, 1);
      assert.equal(
        (
          await outbox.claimEligibleDeliveries({
            now: new Date(),
            limit: 10,
            consumerId: 'consumer-a',
            subscriptions: [AUDIT_SUBSCRIPTION],
          })
        ).length,
        0,
      );
      await outbox.markDelivered(secondClaim[0], new Date());

      await clearCollections();
      const retryEvent = auditFact('pe006-retry');
      await unitOfWork.run((context) => outbox.append(retryEvent, context));
      let attempts = 0;
      const retryConsumer = {
        consumerId: 'retrying-consumer',
        subscriptions: [AUDIT_SUBSCRIPTION],
        handle(): void {
          attempts += 1;
          if (attempts === 1) throw new Error('temporary consumer failure');
        },
      };
      const relay = new OutboxRelayService(
        outbox,
        new EventConsumerRegistry([retryConsumer]),
      );
      const now = new Date();
      assert.deepEqual(await relay.runOnce(now), {
        claimed: 1,
        delivered: 0,
        failed: 1,
      });
      assert.deepEqual(await relay.runOnce(new Date(now.getTime() + 1_000)), {
        claimed: 1,
        delivered: 1,
        failed: 0,
      });
      assert.equal(attempts, 2);
    });

    await clearCollections();
    await runCase('Audit duplicate idempotency', async () => {
      const event = auditFact('pe006-audit-idempotency');
      const consumer = new AuditEventConsumer(
        new MongoAuditRecordStore(auditRecords),
      );
      await consumer.handle(event);
      await consumer.handle(event);
      assert.equal(
        await auditRecords.countDocuments({ eventId: event.event_id }),
        1,
      );
    });
  } finally {
    await connection.dropDatabase();
    await connection.close();
  }
}

async function runCase(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n`);
    throw error;
  }
}

async function outboxCountByEvent(
  connection: Awaited<ReturnType<typeof createConnection>>,
  eventId: string,
): Promise<number> {
  const model = connection.model(OUTBOX_ENTRY_MODEL, OutboxEntrySchema);
  return model.countDocuments({ 'fact.event_id': eventId });
}

function auditFact(
  eventId: string,
  sequence = 1,
  resourceId = eventId,
): AuditFact {
  return {
    event_id: eventId,
    event_type: AUDIT_FACT_EVENT_TYPE,
    event_version: AUDIT_FACT_EVENT_VERSION,
    producer: 'pe006-test-producer',
    occurred_at: new Date().toISOString(),
    resource: { type: 'pe006-test-resource', id: resourceId, sequence },
    payload: {
      actor: { type: 'system', id: 'pe006-test' },
      action: 'pe006.test-event',
      changes: [{ field: 'state', after: eventId }],
    },
    context: {},
  };
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});

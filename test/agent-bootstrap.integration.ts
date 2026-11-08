import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createConnection } from 'mongoose';
import { MongoBootstrapTokenStore } from '@modules/agent-management/infrastructure/mongodb/mongo-bootstrap-token.store';
import { BOOTSTRAP_TOKEN_INDEXES_MIGRATION } from '@modules/agent-management/infrastructure/mongodb/migrations/bootstrap-token-indexes.migration';
import { IssueBootstrapTokenUseCase } from '@modules/agent-management/application/issue-bootstrap-token.use-case';
import { MongoOutboxStore } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import type { MongoOutboxModel } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import { MongoUnitOfWork } from '@platform/events/infrastructure/mongodb/mongo-unit-of-work';
import {
  OUTBOX_ENTRY_MODEL,
  OutboxEntrySchema,
} from '@platform/events/infrastructure/mongodb/outbox.schema';
import { resolveMongoTestConfig } from './mongodb-test-config';

interface VerifiedIndex {
  readonly name?: string;
  readonly unique?: boolean;
  readonly expireAfterSeconds?: number;
}

async function main(): Promise<void> {
  const { uri, dbName } = resolveMongoTestConfig();
  const connection = await createConnection(uri, {
    dbName,
    serverSelectionTimeoutMS: 5_000,
  }).asPromise();
  const database = connection.db;
  if (!database) throw new Error('MongoDB connection has no selected database');
  const admin = database.admin();
  const ttlState: unknown = await admin.command({
    getParameter: 1,
    ttlMonitorEnabled: 1,
  });
  const ttlMonitorWasEnabled = isRecord(ttlState)
    ? ttlState['ttlMonitorEnabled']
    : undefined;
  if (typeof ttlMonitorWasEnabled !== 'boolean') {
    throw new Error('Could not read MongoDB TTL monitor state');
  }
  const tokens = connection.collection('agent_management_bootstrap_tokens');
  const bindings = connection.collection('agent_management_bindings');

  try {
    await admin.command({ setParameter: 1, ttlMonitorEnabled: false });
    await connection.dropDatabase();
    await BOOTSTRAP_TOKEN_INDEXES_MIGRATION.up(connection);

    const tokenIndexes = (await tokens
      .listIndexes()
      .toArray()) as unknown as VerifiedIndex[];
    const bindingIndexes = (await bindings
      .listIndexes()
      .toArray()) as unknown as VerifiedIndex[];
    assert(
      tokenIndexes.some(
        (index) => index.name === 'uq_agent_bootstrap_token_id' && index.unique,
      ),
    );
    assert(
      tokenIndexes.some(
        (index) =>
          index.name === 'uq_agent_bootstrap_token_hash' && index.unique,
      ),
    );
    assert(
      tokenIndexes.some(
        (index) =>
          index.name === 'uq_agent_bootstrap_one_unused_per_node' &&
          index.unique,
      ),
    );
    assert(
      tokenIndexes.some(
        (index) =>
          index.name === 'ttl_agent_bootstrap_expiry' &&
          index.expireAfterSeconds === 0,
      ),
    );
    assert(
      bindingIndexes.some(
        (index) =>
          index.name === 'uq_agent_active_binding_node' && index.unique,
      ),
    );

    const outboxModel = connection.model(OUTBOX_ENTRY_MODEL, OutboxEntrySchema);
    await outboxModel.init();
    const store = new MongoBootstrapTokenStore(connection);
    const outbox = new MongoOutboxStore(
      outboxModel as unknown as MongoOutboxModel,
    );
    const unitOfWork = new MongoUnitOfWork(connection);
    const makeUseCase = () =>
      new IssueBootstrapTokenUseCase(
        {
          getEligibility: () =>
            Promise.resolve({
              exists: true,
              active: true,
              hasActivePlacement: true,
            }),
          serializeEnrollmentEligibility: () => Promise.resolve(true),
        },
        store,
        unitOfWork,
        outbox,
      );

    await bindings.insertOne({ nodeId: 'already-bound', status: 'active' });
    await assert.rejects(
      bindings.insertOne({ nodeId: 'already-bound', status: 'active' }),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000,
    );
    await bindings.insertOne({ nodeId: 'already-bound', status: 'revoked' });
    assert.equal(await store.hasActiveBinding('already-bound'), true);
    await assert.rejects(
      unitOfWork.run((context) =>
        store.issue(
          {
            tokenId: 'must-not-issue',
            nodeId: 'already-bound',
            tokenHash: 'must-not-persist',
            expiresAt: new Date(Date.now() + 60_000),
            createdBy: 'admin',
          },
          context,
        ),
      ),
      /active Agent binding/,
    );
    assert.equal(await tokens.countDocuments({ nodeId: 'already-bound' }), 0);

    const reissue = makeUseCase();
    const first = await reissue.execute({
      nodeId: 'expired-doc-node',
      createdBy: 'admin-1',
    });
    const firstHash = createHash('sha256')
      .update(first.bootstrapToken)
      .digest('hex');
    await tokens.updateOne(
      { tokenHash: firstHash },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );
    assert.equal(
      await tokens.countDocuments({ tokenHash: firstHash }),
      1,
      'expired token must remain before reissue',
    );

    const replacement = await reissue.execute({
      nodeId: 'expired-doc-node',
      createdBy: 'admin-2',
    });
    const expiredRecord = await tokens.findOne({ tokenHash: firstHash });
    const replacementHash = createHash('sha256')
      .update(replacement.bootstrapToken)
      .digest('hex');
    assert(
      expiredRecord?.invalidatedAt instanceof Date,
      'expired but present token is invalidated',
    );
    assert.equal(
      await tokens.countDocuments({
        nodeId: 'expired-doc-node',
        status: 'active',
      }),
      1,
    );
    assert.equal(
      await tokens.countDocuments({
        tokenHash: replacementHash,
        expiresAt: { $gt: new Date() },
      }),
      1,
    );

    const concurrent = makeUseCase();
    const outcomes = await Promise.allSettled([
      concurrent.execute({ nodeId: 'concurrent-node', createdBy: 'admin-3' }),
      concurrent.execute({ nodeId: 'concurrent-node', createdBy: 'admin-4' }),
    ]);
    const successful = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled',
    );
    assert(successful.length >= 1, 'at least one concurrent issuance commits');
    assert.equal(
      await tokens.countDocuments({
        nodeId: 'concurrent-node',
        status: 'active',
      }),
      1,
    );
    const current = await tokens.findOne({
      nodeId: 'concurrent-node',
      status: 'active',
    });
    assert(
      current &&
        successful.some(
          (outcome) =>
            outcome.status === 'fulfilled' &&
            createHash('sha256')
              .update(outcome.value.bootstrapToken)
              .digest('hex') === current.tokenHash,
        ),
    );

    const auditCount = await connection
      .collection('platform_event_outbox')
      .countDocuments({
        'fact.payload.action': 'agent_management.bootstrap_token.issued',
      });
    assert.equal(
      auditCount,
      2 + successful.length,
      'committed issues and secret-free audit facts commit together',
    );
    const auditEntries = await connection
      .collection('platform_event_outbox')
      .find({
        'fact.payload.action': 'agent_management.bootstrap_token.issued',
      })
      .toArray();
    assert(!JSON.stringify(auditEntries).includes('arimms_bt_'));

    process.stdout.write(
      JSON.stringify({
        result: 'passed',
        replicaSet: 'rs0',
        tokenIndexes: tokenIndexes.map((index) => index.name),
        bindingIndexes: bindingIndexes.map((index) => index.name),
        concurrentCommitted: successful.length,
        activeTokensAfterRace: await tokens.countDocuments({
          nodeId: 'concurrent-node',
          status: 'active',
        }),
        expiredRecordWasPresentAndInvalidated: true,
        auditFacts: auditCount,
      }),
    );
  } finally {
    await admin.command({
      setParameter: 1,
      ttlMonitorEnabled: ttlMonitorWasEnabled,
    });
    await connection.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});

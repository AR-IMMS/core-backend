import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createConnection } from 'mongoose';
import { MongoEnrollmentStore } from '@modules/agent-management/infrastructure/mongodb/mongo-enrollment.store';
import { BOOTSTRAP_TOKEN_INDEXES_MIGRATION } from '@modules/agent-management/infrastructure/mongodb/migrations/bootstrap-token-indexes.migration';
import { ENROLLMENT_INDEXES_MIGRATION } from '@modules/agent-management/infrastructure/mongodb/migrations/enrollment-indexes.migration';
import { ENROLLMENT_RECOVERY_MIGRATION } from '@modules/agent-management/infrastructure/mongodb/migrations/enrollment-recovery.migration';
import { EnrollAgentUseCase } from '@modules/agent-management/application/registration/use-cases/enroll-agent.use-case';
import { EnrollmentRecoveryExpiredError } from '@modules/agent-management/domain/errors/registration.errors';
import { EnrollmentRecoveryCipher } from '@modules/agent-management/infrastructure/security/enrollment-recovery-cipher';
import { MongoOutboxStore } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import type { MongoOutboxModel } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import { MongoUnitOfWork } from '@platform/events/infrastructure/mongodb/mongo-unit-of-work';
import {
  OUTBOX_ENTRY_MODEL,
  OutboxEntrySchema,
} from '@platform/events/infrastructure/mongodb/outbox.schema';
import { resolveMongoTestConfig } from './mongodb-test-config';

async function main(): Promise<void> {
  const { uri, dbName } = resolveMongoTestConfig();
  const connection = await createConnection(uri, {
    dbName,
    serverSelectionTimeoutMS: 5_000,
  }).asPromise();
  const database = connection.db;
  if (!database) throw new Error('MongoDB connection has no selected database');
  try {
    await connection.dropDatabase();
    await BOOTSTRAP_TOKEN_INDEXES_MIGRATION.up(connection);
    await ENROLLMENT_INDEXES_MIGRATION.up(connection);
    await ENROLLMENT_RECOVERY_MIGRATION.up(connection);
    const outboxModel = connection.model(OUTBOX_ENTRY_MODEL, OutboxEntrySchema);
    await outboxModel.init();
    const store = new MongoEnrollmentStore(connection);
    const outbox = new MongoOutboxStore(
      outboxModel as unknown as MongoOutboxModel,
    );
    const unitOfWork = new MongoUnitOfWork(connection);
    const bootstrapToken = 'arimms_bt_integration-secret';
    await connection.collection('agent_management_bootstrap_tokens').insertOne({
      tokenId: 'bt-integration',
      nodeId: 'node-integration',
      tokenHash: createHash('sha256').update(bootstrapToken).digest('hex'),
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const createUseCase = () =>
      new EnrollAgentUseCase(
        store,
        {
          getEligibility: () =>
            Promise.resolve({
              exists: true,
              active: true,
              hasActivePlacement: true,
            }),
          serializeEnrollmentEligibility: () => Promise.resolve(true),
        },
        unitOfWork,
        outbox,
        'https://core.example.test/api/v1/agent-control',
        new EnrollmentRecoveryCipher(Buffer.alloc(32, 7).toString('base64')),
        undefined,
        undefined,
        undefined,
      );
    const input = {
      bootstrapToken,
      attemptId: 'd99c38f2-7668-4814-9e70-6416014f83fe',
      installation: { id: '5baf0cba-cf5a-4d39-a3d4-e76263b70810' },
      agent: { version: '0.1.4' },
      environment: { os: 'linux', architecture: 'amd64' },
    };
    const raced = await Promise.allSettled([
      createUseCase().execute(input),
      createUseCase().execute(input),
    ]);
    assert.equal(raced.filter((item) => item.status === 'fulfilled').length, 2);
    assert.equal(
      await connection
        .collection('agent_management_bindings')
        .countDocuments({ nodeId: 'node-integration', status: 'active' }),
      1,
    );
    assert.equal(
      await connection
        .collection('agent_management_enrollment_attempts')
        .countDocuments({ attemptId: input.attemptId }),
      1,
    );
    assert.equal(
      await connection
        .collection('agent_management_installations')
        .countDocuments({ installationId: input.installation.id }),
      1,
    );
    assert.equal(
      await connection
        .collection('agent_management_credentials')
        .countDocuments({
          credentialHash: { $exists: true },
          accessToken: { $exists: true },
        }),
      0,
    );
    await assert.rejects(
      connection
        .collection('agent_management_installations')
        .insertOne({ installationId: input.installation.id }),
      isDuplicateKeyError,
    );
    await assert.rejects(
      connection.collection('agent_management_bindings').insertOne({
        bindingId: 'duplicate-node',
        nodeId: 'node-integration',
        installationId: 'another-installation',
        status: 'active',
      }),
      isDuplicateKeyError,
    );
    await assert.rejects(
      connection.collection('agent_management_bindings').insertOne({
        bindingId: 'duplicate-installation',
        nodeId: 'another-node',
        installationId: input.installation.id,
        status: 'active',
      }),
      isDuplicateKeyError,
    );
    const committed = raced.find((item) => item.status === 'fulfilled');
    assert(committed && committed.status === 'fulfilled');
    const results = raced.flatMap((item) =>
      item.status === 'fulfilled' ? [item.value] : [],
    );
    assert.equal(new Set(results.map((result) => result.accessToken)).size, 1);
    assert.equal(results.filter((result) => result.recovered).length, 1);
    const credentialHash = createHash('sha256')
      .update(committed.value.accessToken)
      .digest('hex');
    assert.equal(
      await connection
        .collection('agent_management_credentials')
        .countDocuments({ credentialHash }),
      1,
    );
    const audit = await connection
      .collection('platform_event_outbox')
      .findOne({ 'fact.payload.action': 'agent_management.agent.enrolled' });
    assert(audit);
    assert(!JSON.stringify(audit).includes(committed.value.accessToken));
    assert(!JSON.stringify(audit).includes(bootstrapToken));
    assert.equal(
      await connection.collection('platform_event_outbox').countDocuments({
        'fact.payload.action': 'agent_management.agent.enrolled',
      }),
      1,
    );
    const recoveryDocument = await connection
      .collection('agent_management_enrollment_recovery')
      .findOne({ attemptId: input.attemptId });
    assert(recoveryDocument);
    assert(!JSON.stringify(recoveryDocument).includes(bootstrapToken));
    assert(
      !JSON.stringify(recoveryDocument).includes(committed.value.accessToken),
    );
    const recoveryExpiresAt: unknown = recoveryDocument['expiresAt'];
    const recoveryCommittedAt: unknown = recoveryDocument['committedAt'];
    assert(recoveryExpiresAt instanceof Date);
    assert(recoveryCommittedAt instanceof Date);
    assert.equal(
      recoveryExpiresAt.getTime() - recoveryCommittedAt.getTime(),
      24 * 60 * 60 * 1000,
    );
    const recoveryIndexes: unknown[] = await connection
      .collection('agent_management_enrollment_recovery')
      .listIndexes()
      .toArray();
    assert(
      recoveryIndexes.some((index) => {
        if (typeof index !== 'object' || index === null) return false;
        const record = index as Record<string, unknown>;
        return (
          record['name'] === 'ttl_agent_enrollment_recovery' &&
          record['expireAfterSeconds'] === 0
        );
      }),
    );

    await connection.collection('agent_management_bootstrap_tokens').deleteOne({
      tokenHash: createHash('sha256').update(bootstrapToken).digest('hex'),
    });
    const replay = await createUseCase().execute(input);
    assert.equal(replay.recovered, true);
    assert.equal(replay.accessToken, committed.value.accessToken);

    await connection
      .collection('agent_management_enrollment_recovery')
      .updateOne(
        { attemptId: input.attemptId },
        { $set: { expiresAt: new Date(Date.now() - 1_000) } },
      );
    await assert.rejects(
      createUseCase().execute(input),
      EnrollmentRecoveryExpiredError,
    );
    assert.equal(
      await connection
        .collection('agent_management_bindings')
        .countDocuments({ nodeId: 'node-integration', status: 'active' }),
      1,
    );

    const legacyAttemptId = '00000000-0000-4000-8000-000000000099';
    const committedAttempt = await connection
      .collection('agent_management_enrollment_attempts')
      .findOne({ attemptId: input.attemptId });
    assert(committedAttempt);
    await connection
      .collection('agent_management_enrollment_attempts')
      .insertOne({
        attemptId: legacyAttemptId,
        installationId: committedAttempt.installationId,
        requestFingerprint: committedAttempt.requestFingerprint,
        bindingId: committedAttempt.bindingId,
        credentialId: committedAttempt.credentialId,
        status: committedAttempt.status,
        committedAt: committedAttempt.committedAt,
      });
    await assert.rejects(
      createUseCase().execute({ ...input, attemptId: legacyAttemptId }),
      EnrollmentRecoveryExpiredError,
    );

    const escrowFailureToken = 'arimms_bt_escrow-failure-secret';
    const escrowFailureTokenHash = createHash('sha256')
      .update(escrowFailureToken)
      .digest('hex');
    const escrowFailureAttemptId = '00000000-0000-4000-8000-000000000101';
    await connection.collection('agent_management_bootstrap_tokens').insertOne({
      tokenId: 'bt-escrow-failure',
      nodeId: 'escrow-failure-node',
      tokenHash: escrowFailureTokenHash,
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await connection
      .collection('agent_management_enrollment_recovery')
      .insertOne({
        attemptId: escrowFailureAttemptId,
        requestFingerprint: 'preexisting',
        encryptedResult: {
          keyVersion: 'v1',
          iv: 'test-iv',
          ciphertext: 'encrypted',
          authTag: 'test-tag',
        },
        committedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
    const credentialCountBeforeEscrowFailure = await connection
      .collection('agent_management_credentials')
      .countDocuments();
    const auditCountBeforeEscrowFailure = await connection
      .collection('platform_event_outbox')
      .countDocuments({
        'fact.payload.action': 'agent_management.agent.enrolled',
      });
    await assert.rejects(
      createUseCase().execute({
        ...input,
        bootstrapToken: escrowFailureToken,
        attemptId: escrowFailureAttemptId,
        installation: { id: '00000000-0000-4000-8000-000000000201' },
      }),
    );
    assert.equal(
      await connection
        .collection('agent_management_bootstrap_tokens')
        .countDocuments({
          tokenHash: escrowFailureTokenHash,
          status: 'active',
        }),
      1,
    );
    assert.equal(
      await connection
        .collection('agent_management_bindings')
        .countDocuments({ nodeId: 'escrow-failure-node', status: 'active' }),
      0,
    );
    assert.equal(
      await connection
        .collection('agent_management_installations')
        .countDocuments({
          installationId: '00000000-0000-4000-8000-000000000201',
        }),
      0,
    );
    assert.equal(
      await connection
        .collection('agent_management_enrollment_attempts')
        .countDocuments({ attemptId: escrowFailureAttemptId }),
      0,
    );
    assert.equal(
      await connection
        .collection('agent_management_credentials')
        .countDocuments(),
      credentialCountBeforeEscrowFailure,
    );
    assert.equal(
      await connection.collection('platform_event_outbox').countDocuments({
        'fact.payload.action': 'agent_management.agent.enrolled',
      }),
      auditCountBeforeEscrowFailure,
    );

    await connection.collection('agent_management_bindings').insertOne({
      bindingId: 'pre-existing-binding',
      nodeId: 'rollback-node',
      installationId: 'other-installation',
      status: 'active',
    });
    const rollbackToken = 'arimms_bt_rollback-secret';
    const rollbackTokenHash = createHash('sha256')
      .update(rollbackToken)
      .digest('hex');
    await connection.collection('agent_management_bootstrap_tokens').insertOne({
      tokenId: 'bt-rollback',
      nodeId: 'rollback-node',
      tokenHash: rollbackTokenHash,
      status: 'active',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await assert.rejects(
      unitOfWork.run((context) =>
        store.enroll(
          {
            tokenHash: rollbackTokenHash,
            now: new Date(),
            attemptId: 'c3961a52-02f8-4c62-b2c4-8ee218ab67ee',
            requestFingerprint: 'request-hash',
            installationId: 'rollback-installation',
            enrollmentId: 'rollback-enrollment',
            agentVersion: '0.1.4',
            environment: { os: 'linux', architecture: 'amd64' },
            metadata: {},
            bindingId: 'rollback-binding',
            credentialId: 'rollback-credential',
            credentialHash: 'credential-hash',
            recoveryExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            encryptedResult: {
              keyVersion: 'v1',
              iv: 'test-iv',
              ciphertext: 'encrypted',
              authTag: 'test-tag',
            },
          },
          context,
        ),
      ),
    );
    assert.equal(
      await connection
        .collection('agent_management_bootstrap_tokens')
        .countDocuments({ tokenHash: rollbackTokenHash, status: 'active' }),
      1,
    );
    assert.equal(
      await connection
        .collection('agent_management_installations')
        .countDocuments({ installationId: 'rollback-installation' }),
      0,
    );
    assert.equal(
      await connection
        .collection('agent_management_credentials')
        .countDocuments({ credentialId: 'rollback-credential' }),
      0,
    );
    assert.equal(
      await connection
        .collection('agent_management_enrollment_attempts')
        .countDocuments({ attemptId: 'c3961a52-02f8-4c62-b2c4-8ee218ab67ee' }),
      0,
    );

    process.stdout.write(
      JSON.stringify({
        result: 'passed',
        replicaSet: 'required-by-transaction',
        concurrentSameAttemptRecovered: true,
        credentialHashOnly: true,
        auditSecretFree: true,
        bindingFailureRolledBack: true,
        recoveryWriteFailureRolledBack: true,
        legacyAttemptRejectedAfterRecoveryExpiry: true,
      }),
    );
  } finally {
    await connection.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

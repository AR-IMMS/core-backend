import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection } from 'mongoose';
import { MongoEnrollmentStore } from '@modules/agent-management/infrastructure/mongodb/mongo-enrollment.store';
import { MongoAgentAccessStore } from '@modules/agent-management/infrastructure/mongodb/mongo-agent-access.store';
import { BOOTSTRAP_TOKEN_INDEXES_MIGRATION } from '@modules/agent-management/infrastructure/mongodb/migrations/bootstrap-token-indexes.migration';
import { ENROLLMENT_INDEXES_MIGRATION } from '@modules/agent-management/infrastructure/mongodb/migrations/enrollment-indexes.migration';
import { ENROLLMENT_RECOVERY_MIGRATION } from '@modules/agent-management/infrastructure/mongodb/migrations/enrollment-recovery.migration';
import { AGENT_ACCESS_INDEXES_MIGRATION } from '@modules/agent-management/infrastructure/mongodb/migrations/agent-access-indexes.migration';
import { EnrollAgentUseCase } from '@modules/agent-management/application/enroll-agent.use-case';
import { EnrollmentRecoveryRevokedError } from '@modules/agent-management/application/enrollment.port';
import { AgentBindingRevocationUnavailableError } from '@modules/agent-management/application/agent-access.port';
import { RevokeAgentBindingUseCase } from '@modules/agent-management/application/revoke-agent-binding.use-case';
import { EnrollmentRecoveryCipher } from '@modules/agent-management/infrastructure/security/enrollment-recovery-cipher';
import { MongoOutboxStore } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import type { MongoOutboxModel } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import { MongoUnitOfWork } from '@platform/events/infrastructure/mongodb/mongo-unit-of-work';
import type { OutboxWriterPort } from '@platform/events';
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
    await AGENT_ACCESS_INDEXES_MIGRATION.up(connection);

    const outboxModel = connection.model(OUTBOX_ENTRY_MODEL, OutboxEntrySchema);
    await outboxModel.init();
    const outbox = new MongoOutboxStore(
      outboxModel as unknown as MongoOutboxModel,
    );
    const unitOfWork = new MongoUnitOfWork(connection);
    const enrollmentStore = new MongoEnrollmentStore(connection);
    const accessStore = new MongoAgentAccessStore(connection);
    const recoveryCipher = new EnrollmentRecoveryCipher(
      Buffer.alloc(32, 7).toString('base64'),
    );
    const createEnrollmentUseCase = () =>
      new EnrollAgentUseCase(
        enrollmentStore,
        {
          getEligibility: () =>
            Promise.resolve({
              exists: true,
              active: true,
              hasActivePlacement: true,
            }),
        },
        unitOfWork,
        outbox,
        'https://core.example.test/api/v1/agent-control',
        recoveryCipher,
      );
    const createRevocationUseCase = (
      append: OutboxWriterPort['append'] = outbox.append.bind(outbox),
    ) =>
      new RevokeAgentBindingUseCase(accessStore, unitOfWork, {
        append,
      });

    const bootstrapToken = 'arimms_bt_agent-access-integration';
    const attemptId = randomUUID();
    const installationId = randomUUID();
    await insertBootstrapToken(connection, bootstrapToken, 'node-agent-access');
    const input = enrollmentInput(bootstrapToken, attemptId, installationId);
    const created = await createEnrollmentUseCase().execute(input);
    const credentialHash = hash(created.accessToken);
    const originalInstallation = await connection
      .collection('agent_management_installations')
      .findOne({ installationId });
    const originalCreatedAt: unknown = originalInstallation?.['createdAt'];
    assert(originalCreatedAt instanceof Date);

    assert.deepEqual(
      await accessStore.findActivePrincipalByCredentialHash(credentialHash),
      {
        installationId,
        bindingId: created.binding.id,
        nodeId: 'node-agent-access',
      },
    );
    assert.equal(
      await accessStore.findActivePrincipalByCredentialHash(hash('unknown')),
      null,
    );
    assert.equal(
      await accessStore.findActivePrincipalByCredentialHash(
        hash(bootstrapToken),
      ),
      null,
    );
    await connection
      .collection('agent_management_bindings')
      .updateOne(
        { bindingId: created.binding.id },
        { $set: { installationId: 'inconsistent-installation' } },
      );
    assert.equal(
      await accessStore.findActivePrincipalByCredentialHash(credentialHash),
      null,
    );
    await connection
      .collection('agent_management_bindings')
      .updateOne(
        { bindingId: created.binding.id },
        { $set: { installationId } },
      );
    const recovered = await createEnrollmentUseCase().execute(input);
    assert.equal(recovered.accessToken, created.accessToken);

    const rollbackToken = 'arimms_bt_agent-access-rollback';
    await insertBootstrapToken(connection, rollbackToken, 'node-rollback');
    const rollbackEnrollment = await createEnrollmentUseCase().execute(
      enrollmentInput(rollbackToken, randomUUID(), randomUUID()),
    );
    const failingRevoke = createRevocationUseCase(() =>
      Promise.reject(new Error('outbox failure')),
    );
    await assert.rejects(
      failingRevoke.execute({
        bindingId: rollbackEnrollment.binding.id,
        actorId: 'admin-integration',
      }),
      AgentBindingRevocationUnavailableError,
    );
    assert.equal(
      await connection.collection('agent_management_bindings').countDocuments({
        bindingId: rollbackEnrollment.binding.id,
        status: 'active',
      }),
      1,
    );
    assert.equal(
      await connection
        .collection('agent_management_credentials')
        .countDocuments({
          bindingId: rollbackEnrollment.binding.id,
          status: 'active',
        }),
      1,
    );

    let revokeCommitted = false;
    const revokeUseCase = createRevocationUseCase();
    const concurrentRecovery = createEnrollmentUseCase()
      .execute(input)
      .then((result) => {
        assert.equal(revokeCommitted, false);
        return result;
      });
    const revokeOne = revokeUseCase
      .execute({
        bindingId: created.binding.id,
        actorId: 'admin-integration',
      })
      .then(() => {
        revokeCommitted = true;
      });
    const revokeTwo = revokeUseCase
      .execute({
        bindingId: created.binding.id,
        actorId: 'admin-integration',
      })
      .then(() => {
        revokeCommitted = true;
      });
    const concurrentRevokes = Promise.all([revokeOne, revokeTwo]);
    const [recoveryRace, revokeRace] = await Promise.allSettled([
      concurrentRecovery,
      concurrentRevokes,
    ]);
    assert.equal(revokeRace.status, 'fulfilled');
    if (recoveryRace.status === 'rejected') {
      assert(recoveryRace.reason instanceof EnrollmentRecoveryRevokedError);
    } else {
      assert.equal(recoveryRace.value.recovered, true);
    }

    assert.equal(
      await connection
        .collection('agent_management_bindings')
        .countDocuments({ bindingId: created.binding.id, status: 'revoked' }),
      1,
    );
    assert.equal(
      await connection
        .collection('agent_management_credentials')
        .countDocuments({ bindingId: created.binding.id, status: 'revoked' }),
      1,
    );
    assert.equal(
      await accessStore.findActivePrincipalByCredentialHash(credentialHash),
      null,
    );
    await assert.rejects(
      createEnrollmentUseCase().execute(input),
      EnrollmentRecoveryRevokedError,
    );
    assert.equal(
      await connection.collection('platform_event_outbox').countDocuments({
        'fact.payload.action': 'agent_management.agent_binding.revoked',
        'fact.resource.id': created.binding.id,
      }),
      1,
    );
    const revocationAudit = await connection
      .collection('platform_event_outbox')
      .findOne({
        'fact.payload.action': 'agent_management.agent_binding.revoked',
      });
    assert(revocationAudit);
    assert(!JSON.stringify(revocationAudit).includes(created.accessToken));

    const reEnrollmentToken = 'arimms_bt_agent-access-reregister';
    await insertBootstrapToken(
      connection,
      reEnrollmentToken,
      'node-agent-access',
    );
    const reEnrollmentInput = {
      ...enrollmentInput(reEnrollmentToken, randomUUID(), installationId),
      agent: { version: '0.2.0' },
      environment: {
        os: 'windows',
        architecture: 'amd64',
        hostname: 'new-host',
      },
      metadata: { deployment_kind: 'vm', revision: 2 },
    };
    const reEnrolled =
      await createEnrollmentUseCase().execute(reEnrollmentInput);
    assert.notEqual(reEnrolled.binding.id, created.binding.id);
    const installation = await connection
      .collection('agent_management_installations')
      .findOne({ installationId });
    assert.equal(
      await connection
        .collection('agent_management_installations')
        .countDocuments({ installationId }),
      1,
    );
    const reRegisteredCreatedAt: unknown = installation?.['createdAt'];
    assert(reRegisteredCreatedAt instanceof Date);
    assert.equal(reRegisteredCreatedAt.getTime(), originalCreatedAt.getTime());
    assert.equal(installation?.['agentVersion'], '0.2.0');
    assert.deepEqual(
      installation?.['environment'],
      reEnrollmentInput.environment,
    );
    assert.deepEqual(installation?.['metadata'], reEnrollmentInput.metadata);
    assert.equal(
      await connection
        .collection('agent_management_bindings')
        .countDocuments({ installationId }),
      2,
    );
    assert.equal(
      await connection
        .collection('agent_management_bindings')
        .countDocuments({ installationId, status: 'active' }),
      1,
    );
    assert.deepEqual(
      await accessStore.findActivePrincipalByCredentialHash(
        hash(reEnrolled.accessToken),
      ),
      {
        installationId,
        bindingId: reEnrolled.binding.id,
        nodeId: 'node-agent-access',
      },
    );

    await assert.rejects(
      connection.collection('agent_management_bindings').insertOne({
        bindingId: created.binding.id,
        installationId,
        nodeId: 'another-node',
        status: 'revoked',
      }),
      isDuplicateKeyError,
    );
    await assert.rejects(
      connection.collection('agent_management_bindings').insertOne({
        bindingId: 'duplicate-active-binding',
        installationId,
        nodeId: 'another-node',
        status: 'active',
      }),
      isDuplicateKeyError,
    );
    await assert.rejects(
      connection.collection('agent_management_bindings').insertOne({
        bindingId: 'duplicate-active-node',
        installationId: 'another-installation',
        nodeId: 'node-agent-access',
        status: 'active',
      }),
      isDuplicateKeyError,
    );

    process.stdout.write(
      JSON.stringify({
        result: 'passed',
        replicaSet: 'required-by-transaction',
        activeCredentialResolvedToTrustedPrincipal: true,
        recoveryRejectedAfterRevocation: true,
        concurrentRevocationAuditedOnce: true,
        revocationRollbackOnOutboxFailure: true,
        sameInstallationReRegisteredWithHistory: true,
        uniqueBindingAndActiveBindingIndexes: true,
      }),
    );
  } finally {
    await connection.close();
  }
}

function enrollmentInput(
  bootstrapToken: string,
  attemptId: string,
  installationId: string,
) {
  return {
    bootstrapToken,
    attemptId,
    installation: { id: installationId },
    agent: { version: '0.1.4' },
    environment: { os: 'linux', architecture: 'amd64' },
    metadata: { deployment_kind: 'host' },
  };
}

async function insertBootstrapToken(
  connection: Awaited<ReturnType<typeof createConnection>>,
  value: string,
  nodeId: string,
): Promise<void> {
  await connection.collection('agent_management_bootstrap_tokens').insertOne({
    tokenId: randomUUID(),
    nodeId,
    tokenHash: hash(value),
    status: 'active',
    expiresAt: new Date(Date.now() + 60_000),
  });
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});

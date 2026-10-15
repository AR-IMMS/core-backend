import assert from 'node:assert/strict';
import { createConnection } from 'mongoose';

import { UserProvisioningService } from '@modules/iam/application/user-provisioning.service';
import {
  IAM_SESSION_MODEL,
  IamSessionSchema,
} from '@modules/iam/infrastructure/mongodb/iam-session.schema';
import {
  IAM_USER_MODEL,
  IamUserSchema,
} from '@modules/iam/infrastructure/mongodb/iam-user.schema';
import {
  MongoHumanAuthStore,
  type MongoHumanAccountModel,
  type MongoHumanSessionModel,
} from '@modules/iam/infrastructure/mongodb/mongo-human-auth.store';
import type { PasswordHasherPort } from '@modules/iam/application/ports/password-hasher.port';
import { MongoOutboxStore } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import type { MongoOutboxModel } from '@platform/events/infrastructure/mongodb/mongo-outbox.store';
import {
  OUTBOX_ENTRY_MODEL,
  OutboxEntrySchema,
} from '@platform/events/infrastructure/mongodb/outbox.schema';
import { MongoUnitOfWork } from '@platform/events/infrastructure/mongodb/mongo-unit-of-work';
import { resolveMongoTestConfig } from './mongodb-test-config';

async function main(): Promise<void> {
  const { uri, dbName } = resolveMongoTestConfig();
  const connection = await createConnection(uri, {
    dbName,
    serverSelectionTimeoutMS: 5_000,
  }).asPromise();

  try {
    await connection.dropDatabase();
    const users = connection.model(IAM_USER_MODEL, IamUserSchema);
    const sessions = connection.model(IAM_SESSION_MODEL, IamSessionSchema);
    const outboxModel = connection.model(OUTBOX_ENTRY_MODEL, OutboxEntrySchema);
    await Promise.all([users.init(), sessions.init(), outboxModel.init()]);

    const store = new MongoHumanAuthStore(
      users as unknown as MongoHumanAccountModel,
      sessions as unknown as MongoHumanSessionModel,
    );
    const outbox = new MongoOutboxStore(
      outboxModel as unknown as MongoOutboxModel,
    );
    const unitOfWork = new MongoUnitOfWork(connection);
    const passwords: PasswordHasherPort = {
      hash: async (password) => `argon2id:${password}`,
      verify: async () => true,
    };
    const service = new UserProvisioningService(
      store,
      passwords,
      unitOfWork,
      outbox,
      () => new Date('2026-10-15T12:00:00.000Z'),
      (() => {
        let nextId = 0;
        return () => `iam-provisioning-${++nextId}`;
      })(),
      () => 'temporary-secret-for-integration',
    );

    await runCase('provision and audit commit atomically', async () => {
      const created = await service.createUser({
        actorUserId: 'admin-1',
        username: '  Operator  ',
        email: 'OPERATOR@example.test',
        role: 'OPERATOR',
      });
      const stored = await users
        .findOne({ userId: created.userId })
        .select('+passwordHash')
        .lean();
      assert.equal(stored?.normalizedUsername, 'operator');
      assert.equal(stored?.normalizedEmail, 'operator@example.test');
      assert.equal(
        stored?.passwordHash,
        'argon2id:temporary-secret-for-integration',
      );
      assert.equal(stored?.mustChangePassword, true);
      assert.equal(stored?.auditSequence, 1);

      const fact = await outboxModel
        .findOne({
          'fact.resource.id': created.userId,
        })
        .lean();
      assert.equal(fact?.fact.event_type, 'audit.fact');
      assert.equal(fact?.fact.event_version, 1);
      assert.equal(fact?.fact.resource.sequence, 1);
      assert.equal(fact?.fact.payload.action, 'iam.user.created');
      assert.equal(
        JSON.stringify(fact?.fact).includes('temporary-secret-for-integration'),
        false,
      );
    });

    await runCase(
      'Outbox failure rolls back the provisioned user',
      async () => {
        const failingService = new UserProvisioningService(
          store,
          passwords,
          unitOfWork,
          {
            append: async () => {
              throw new Error('outbox unavailable');
            },
          },
          () => new Date(),
          () => 'iam-provisioning-rollback',
          () => 'temporary-secret-for-rollback',
        );
        await assert.rejects(
          failingService.createUser({
            actorUserId: 'admin-1',
            username: 'RollbackUser',
            email: 'rollback@example.test',
            role: 'TECHNICIAN',
          }),
          /outbox unavailable/,
        );
        assert.equal(
          await users.countDocuments({ userId: 'iam-provisioning-rollback' }),
          0,
        );
        assert.equal(
          await outboxModel.countDocuments({
            'fact.resource.id': 'iam-provisioning-rollback',
          }),
          0,
        );
      },
    );

    await runCase('concurrent seeds create one initial IT Admin', async () => {
      const [first, second] = await Promise.all([
        service.bootstrapInitialAdmin({
          userId: 'seed-admin-a',
          username: 'ITAdminA',
          email: 'it-admin-a@example.test',
          initialPassword: 'deployment-secret-a',
        }),
        service.bootstrapInitialAdmin({
          userId: 'seed-admin-b',
          username: 'ITAdminB',
          email: 'it-admin-b@example.test',
          initialPassword: 'deployment-secret-b',
        }),
      ]);
      assert.deepEqual([first, second].sort(), ['already-exists', 'created']);
      assert.equal(await users.countDocuments({ role: 'IT_ADMIN' }), 1);
      assert.equal(
        await outboxModel.countDocuments({
          'fact.payload.action': 'iam.user.created',
        }),
        2,
      );
    });

    await runCase(
      'optimistic sequence allocation permits one concurrent winner',
      async () => {
        const target = await users
          .findOne({ normalizedUsername: 'operator' })
          .lean();
        assert.ok(target);
        const outcomes = await Promise.all(
          [1, 2].map(() =>
            unitOfWork.run((context) =>
              store.allocateAuditSequence(target.userId, 1, context),
            ),
          ),
        );
        assert.equal(outcomes.filter((sequence) => sequence === 2).length, 1);
        assert.equal(
          outcomes.filter((sequence) => sequence === null).length,
          1,
        );
        const updated = await users.findOne({ userId: target.userId }).lean();
        assert.equal(updated?.auditSequence, 2);
      },
    );
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

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});

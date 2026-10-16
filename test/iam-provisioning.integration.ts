import assert from 'node:assert/strict';
import { createConnection } from 'mongoose';

import { UserProvisioningService } from '@modules/iam/application/user-provisioning.service';
import {
  AuthService,
  hashRefreshToken,
} from '@modules/iam/application/auth.service';
import type { AccessTokenIssuerPort } from '@modules/iam/application/ports/access-token-issuer.port';
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
      users,
      sessions as unknown as MongoHumanSessionModel,
    );
    const outbox = new MongoOutboxStore(
      outboxModel as unknown as MongoOutboxModel,
    );
    const unitOfWork = new MongoUnitOfWork(connection);
    const passwords: PasswordHasherPort = {
      hash: (password) => Promise.resolve(`argon2id:${password}`),
      verify: () => Promise.resolve(true),
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
            append: () => Promise.reject(new Error('outbox unavailable')),
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
      'concurrent refresh-token replay has one winner and revokes the session',
      async () => {
        const target = await users
          .findOne({ normalizedUsername: 'operator' })
          .lean();
        assert.ok(target);
        const refreshToken = 'R'.repeat(43);
        await store.create({
          sessionId: 'iam-auth-refresh-race',
          userId: target.userId,
          refreshTokenHash: hashRefreshToken(refreshToken),
          expiresAt: new Date('2026-10-22T12:00:00.000Z'),
        });
        const tokens: AccessTokenIssuerPort = {
          issueAccessToken: () => Promise.resolve('signed-access-token'),
        };
        const auth = new AuthService(
          store,
          store,
          passwords,
          tokens,
          900,
          604_800,
          () => new Date('2026-10-15T12:00:00.000Z'),
        );
        const results = await Promise.allSettled([
          auth.refresh(refreshToken),
          auth.refresh(refreshToken),
        ]);
        assert.equal(
          results.filter((result) => result.status === 'fulfilled').length,
          1,
        );
        assert.equal(
          results.filter((result) => result.status === 'rejected').length,
          1,
        );
        const storedSession = await sessions
          .findOne({ sessionId: 'iam-auth-refresh-race' })
          .lean();
        assert.ok(storedSession?.revokedAt);
      },
    );

    await runCase(
      'password change and Audit fact commit together without recording credentials',
      async () => {
        const target = await users
          .findOne({ normalizedUsername: 'operator' })
          .lean();
        assert.ok(target);
        await store.create({
          sessionId: 'iam-auth-password-current',
          userId: target.userId,
          refreshTokenHash: hashRefreshToken('P'.repeat(43)),
          expiresAt: new Date('2026-10-22T12:00:00.000Z'),
        });
        await store.create({
          sessionId: 'iam-auth-password-other',
          userId: target.userId,
          refreshTokenHash: hashRefreshToken('Q'.repeat(43)),
          expiresAt: new Date('2026-10-22T12:00:00.000Z'),
        });
        await service.changePassword({
          userId: target.userId,
          sessionId: 'iam-auth-password-current',
          currentPassword: 'old-password',
          newPassword: 'new-password-that-is-secret',
        });
        const changed = await users
          .findOne({ userId: target.userId })
          .select('+passwordHash')
          .lean();
        assert.equal(changed?.mustChangePassword, false);
        assert.equal(
          changed?.passwordHash,
          'argon2id:new-password-that-is-secret',
        );
        const otherSession = await sessions
          .findOne({ sessionId: 'iam-auth-password-other' })
          .lean();
        assert.ok(otherSession?.revokedAt);
        const fact = await outboxModel
          .findOne({ 'fact.payload.action': 'iam.credential.changed' })
          .lean();
        assert.equal(fact?.fact.event_type, 'audit.fact');
        assert.equal(fact?.fact.event_version, 1);
        assert.equal(
          JSON.stringify(fact?.fact).includes('new-password-that-is-secret'),
          false,
        );
        const failingPasswordChange = new UserProvisioningService(
          store,
          passwords,
          unitOfWork,
          {
            append: () => Promise.reject(new Error('outbox unavailable')),
          },
          () => new Date('2026-10-15T12:00:00.000Z'),
        );
        await assert.rejects(
          failingPasswordChange.changePassword({
            userId: target.userId,
            sessionId: 'iam-auth-password-current',
            currentPassword: 'old-password',
            newPassword: 'rollback-password-must-not-persist',
          }),
          /outbox unavailable/,
        );
        const afterRollback = await users
          .findOne({ userId: target.userId })
          .select('+passwordHash')
          .lean();
        assert.equal(afterRollback?.passwordHash, changed?.passwordHash);
        assert.equal(afterRollback?.auditSequence, changed?.auditSequence);
        assert.equal(
          await outboxModel.countDocuments({
            'fact.resource.id': target.userId,
            'fact.payload.action': 'iam.credential.changed',
          }),
          1,
        );
      },
    );

    await runCase(
      'optimistic sequence allocation permits one concurrent winner',
      async () => {
        const target = await users
          .findOne({ normalizedUsername: 'operator' })
          .lean();
        assert.ok(target);
        const expectedSequence = target.auditSequence;
        const outcomes = await Promise.all(
          [1, 2].map(() =>
            unitOfWork.run((context) =>
              store.allocateAuditSequence(
                target.userId,
                expectedSequence,
                context,
              ),
            ),
          ),
        );
        assert.equal(
          outcomes.filter((sequence) => sequence === expectedSequence + 1)
            .length,
          1,
        );
        assert.equal(
          outcomes.filter((sequence) => sequence === null).length,
          1,
        );
        const updated = await users.findOne({ userId: target.userId }).lean();
        assert.equal(updated?.auditSequence, expectedSequence + 1);
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

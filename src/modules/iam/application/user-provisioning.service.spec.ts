/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any. */
import type { OutboxWriterPort } from '@platform/events';
import type { UnitOfWorkPort } from '@platform/events';

import type {
  HumanAuthStorePort,
  HumanSessionStorePort,
} from './ports/human-auth-store.port';
import type { PasswordHasherPort } from './ports/password-hasher.port';
import { UserProvisioningService } from './user-provisioning.service';

describe('UserProvisioningService', () => {
  /** It persists only a password hash and atomically audits a provisioned user. */
  test('creates an admin-provisioned user with a one-time temporary password', async () => {
    const context = {} as Parameters<Parameters<UnitOfWorkPort['run']>[0]>[0];
    const store = makeStore();
    const hasher = makeHasher();
    const outbox = { append: jest.fn().mockResolvedValue(undefined) };
    const unitOfWork: UnitOfWorkPort = {
      run: jest.fn(async (operation) => operation(context)),
    };
    const service = new UserProvisioningService(
      store,
      hasher,
      unitOfWork,
      outbox as OutboxWriterPort,
      () => new Date('2026-10-15T12:00:00.000Z'),
      () => 'user-2',
      () => 'temporary-secret',
    );

    const result = await service.createUser({
      actorUserId: 'admin-1',
      username: ' NewOperator ',
      email: 'NEW@EXAMPLE.TEST ',
      role: 'OPERATOR',
    });

    expect(result).toMatchObject({
      userId: 'user-2',
      username: 'NewOperator',
      email: 'new@example.test',
      role: 'OPERATOR',
      status: 'ACTIVE',
      mustChangePassword: true,
      temporaryPassword: 'temporary-secret',
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Jest inspects the mock function and never invokes it without its owner.
    expect(jest.mocked(hasher.hash).mock.calls).toContainEqual([
      'temporary-secret',
    ]);
    expect(store.createProvisionedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        username: 'NewOperator',
        normalizedUsername: 'newoperator',
        email: 'new@example.test',
        normalizedEmail: 'new@example.test',
        passwordHash: 'encoded-password',
      }),
      context,
    );
    expect(store.allocateAuditSequence).toHaveBeenCalledWith(
      'user-2',
      0,
      context,
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'audit.fact',
        event_version: 1,
        resource: { type: 'iam.user', id: 'user-2', sequence: 1 },
        payload: expect.objectContaining({
          actor: { type: 'user', id: 'admin-1' },
          action: 'iam.user.created',
          changes: expect.not.arrayContaining([
            expect.objectContaining({
              field: expect.stringMatching(/password/i),
            }),
          ]),
        }),
      }),
      context,
    );
  });

  /** It stops before writing account data when the user sequence has changed. */
  test('aborts a create when optimistic sequence allocation conflicts', async () => {
    const store = makeStore();
    store.allocateAuditSequence = jest.fn().mockResolvedValue(null);
    const outbox = { append: jest.fn().mockResolvedValue(undefined) };
    const service = makeService(store, outbox);

    await expect(
      service.createUser({
        actorUserId: 'admin-1',
        username: 'NewOperator',
        email: 'new@example.test',
        role: 'OPERATOR',
      }),
    ).rejects.toThrow('IAM audit sequence changed concurrently');
    expect(outbox.append).not.toHaveBeenCalled();
  });

  /** It makes initial-admin bootstrap idempotent if any IT Admin already exists. */
  test('does not create or audit a second initial administrator', async () => {
    const store = makeStore();
    store.hasAnyItAdmin = jest.fn().mockResolvedValue(true);
    const hasher = makeHasher();
    const outbox = { append: jest.fn().mockResolvedValue(undefined) };
    const service = makeService(store, outbox, hasher);

    await expect(service.bootstrapInitialAdmin({})).resolves.toBe(
      'already-exists',
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Jest inspects the mock function and never invokes it without its owner.
    expect(jest.mocked(hasher.hash).mock.calls).toHaveLength(0);
    expect(store.createInitialAdmin).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  /** It writes bootstrap user state and its fact in the same transaction. */
  test('creates the first administrator with forced password rotation and bootstrap actor', async () => {
    const store = makeStore();
    const outbox = { append: jest.fn().mockResolvedValue(undefined) };
    const service = makeService(store, outbox);

    await expect(
      service.bootstrapInitialAdmin({
        userId: 'admin-1',
        username: 'ITAdmin',
        email: 'admin@example.test',
        initialPassword: 'secret-from-deployment',
      }),
    ).resolves.toBe('created');
    expect(store.createInitialAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        passwordHash: 'encoded-password',
      }),
      expect.anything(),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          actor: { type: 'service', id: 'iam-initial-admin-bootstrap' },
          action: 'iam.user.created',
        }),
      }),
      expect.anything(),
    );
  });

  /** It changes a forced initial password, revokes other sessions, and audits atomically. */
  test('completes the forced password change with the next user event sequence', async () => {
    const store = makeStore();
    store.findByUserId = jest.fn().mockResolvedValue({
      userId: 'user-1',
      username: 'operator',
      email: 'operator@example.test',
      normalizedUsername: 'operator',
      normalizedEmail: 'operator@example.test',
      displayName: null,
      role: 'OPERATOR',
      status: 'ACTIVE',
      additionalPermissions: [],
      passwordHash: 'old-hash',
      mustChangePassword: true,
      auditSequence: 1,
    });
    store.updatePasswordWithAuditSequence = jest.fn().mockResolvedValue(2);
    const outbox = { append: jest.fn().mockResolvedValue(undefined) };
    const service = makeService(store, outbox);

    await service.changePassword({
      userId: 'user-1',
      sessionId: 'session-1',
      newPassword: 'correct horse battery staple',
    });

    expect(store.updatePasswordWithAuditSequence).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        expectedSequence: 1,
        passwordHash: 'encoded-password',
      }),
      expect.anything(),
    );
    expect(store.revokeSessionsExcept).toHaveBeenCalledWith(
      'user-1',
      'session-1',
      expect.any(Date),
      expect.anything(),
    );
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: { type: 'iam.user', id: 'user-1', sequence: 2 },
        payload: expect.objectContaining({ action: 'iam.credential.changed' }),
      }),
      expect.anything(),
    );
  });

  /** It requires current-password proof for accounts without a forced rotation. */
  test('rejects a wrong current password before changing credential state', async () => {
    const store = makeStore();
    store.findByUserId = jest.fn().mockResolvedValue({
      userId: 'user-1',
      username: 'operator',
      email: 'operator@example.test',
      normalizedUsername: 'operator',
      normalizedEmail: 'operator@example.test',
      displayName: null,
      role: 'OPERATOR',
      status: 'ACTIVE',
      additionalPermissions: [],
      passwordHash: 'current-hash',
      mustChangePassword: false,
      auditSequence: 1,
    });
    const hasher = makeHasher();
    hasher.verify = jest.fn().mockResolvedValue(false);
    const outbox = { append: jest.fn().mockResolvedValue(undefined) };
    const service = makeService(store, outbox, hasher);

    await expect(
      service.changePassword({
        userId: 'user-1',
        sessionId: 'session-1',
        currentPassword: 'wrong-password',
        newPassword: 'correct horse battery staple',
      }),
    ).rejects.toThrow('Current password is invalid');
    expect(store.updatePasswordWithAuditSequence).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  /** It rejects role codes outside IAM's fixed catalog before hashing a credential. */
  test('rejects unsupported roles for provisioned accounts', async () => {
    const hasher = makeHasher();
    const service = makeService(makeStore(), { append: jest.fn() }, hasher);

    await expect(
      service.createUser({
        actorUserId: 'admin-1',
        username: 'Agent',
        email: 'agent@example.test',
        role: 'AGENT' as never,
      }),
    ).rejects.toThrow('Unsupported IAM role');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Jest inspects the mock function and never invokes it without its owner.
    expect(jest.mocked(hasher.hash).mock.calls).toHaveLength(0);
  });
});

function makeService(
  store: ReturnType<typeof makeStore>,
  outbox: { append: jest.Mock },
  hasher = makeHasher(),
): UserProvisioningService {
  const unitOfWork: UnitOfWorkPort = {
    run: jest.fn(async (operation) => operation({} as never)),
  };
  return new UserProvisioningService(
    store,
    hasher,
    unitOfWork,
    outbox as OutboxWriterPort,
    () => new Date('2026-10-15T12:00:00.000Z'),
    () => 'user-2',
    () => 'temporary-secret',
  );
}

function makeStore(): HumanAuthStorePort &
  Pick<HumanSessionStorePort, 'revokeSessionsExcept'> {
  return {
    findByIdentifier: jest.fn(),
    findByUserId: jest.fn(),
    hasAnyItAdmin: jest.fn().mockResolvedValue(false),
    createInitialAdmin: jest.fn().mockResolvedValue(undefined),
    createProvisionedUser: jest.fn().mockResolvedValue(undefined),
    allocateAuditSequence: jest.fn().mockResolvedValue(1),
    updatePasswordWithAuditSequence: jest.fn().mockResolvedValue(2),
    updatePassword: jest.fn(),
    revokeSessionsExcept: jest.fn().mockResolvedValue(undefined),
  };
}

function makeHasher(): PasswordHasherPort {
  return {
    hash: jest.fn().mockResolvedValue('encoded-password'),
    verify: jest.fn(),
  };
}

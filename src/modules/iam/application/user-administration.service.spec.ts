import type {
  OutboxWriterPort,
  UnitOfWorkContext,
  UnitOfWorkPort,
} from '@platform/events';
import type { PasswordHasherPort } from './ports/password-hasher.port';
import type { UserAdministrationStorePort } from './ports/user-administration-store.port';
import {
  LastActiveItAdminError,
  SelfUserPermissionChangeError,
  UserAdministrationService,
} from './user-administration.service';

/* eslint-disable @typescript-eslint/unbound-method -- Jest matchers inspect mocked methods. */

describe('UserAdministrationService', () => {
  const now = new Date('2026-10-16T12:00:00.000Z');
  const context = {} as UnitOfWorkContext;

  function createHarness(overrides: Partial<UserAdministrationStorePort> = {}) {
    const user = {
      userId: 'user-2',
      username: 'Technician',
      email: 'tech@example.test',
      displayName: null,
      role: 'TECHNICIAN' as const,
      status: 'ACTIVE' as const,
      additionalPermissions: [] as const,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
      auditSequence: 2,
    };
    const store = {
      findUser: jest.fn().mockResolvedValue(user),
      listUsers: jest.fn(),
      countActiveItAdmins: jest.fn().mockResolvedValue(2),
      guardActiveAdminSet: jest.fn().mockResolvedValue(undefined),
      updateProfile: jest.fn().mockResolvedValue(3),
      replaceRole: jest.fn().mockResolvedValue(3),
      replacePermissions: jest.fn().mockResolvedValue(3),
      setStatus: jest.fn().mockResolvedValue(3),
      resetCredential: jest.fn().mockResolvedValue(3),
      revokeSessions: jest.fn().mockResolvedValue(1),
      ...overrides,
    };
    const append = jest
      .fn<OutboxWriterPort['append']>()
      .mockResolvedValue(undefined);
    const appendedFacts: unknown[] = [];
    append.mockImplementation((fact) => {
      appendedFacts.push(fact);
      return Promise.resolve();
    });
    const outbox: OutboxWriterPort = { append };
    const passwords = {
      hash: jest.fn().mockResolvedValue('hashed-temporary-credential'),
      verify: jest.fn(),
    } as unknown as PasswordHasherPort;
    const unitOfWork: UnitOfWorkPort = {
      run: jest.fn((operation) => operation(context)),
    };
    const service = new UserAdministrationService(
      store,
      passwords,
      unitOfWork,
      outbox,
      () => now,
      () => 'temporary-credential',
    );
    return {
      service,
      store,
      append,
      appendedFacts,
      passwords,
      unitOfWork,
      user,
    };
  }

  /** Permission replacement records both complete sets in one Audit Fact v2. */
  test('replaces additional permissions with one v2 audit fact', async () => {
    const { service, append, appendedFacts, store } = createHarness();

    await service.replaceAdditionalPermissions({
      actorUserId: 'admin-1',
      userId: 'user-2',
      permissions: ['maintenance:verify'],
    });

    expect(store.replacePermissions).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        expectedSequence: 2,
        additionalPermissions: ['maintenance:verify'],
      }),
      context,
    );
    expect(append).toHaveBeenCalledTimes(1);
    expect(appendedFacts[0]).toMatchObject({
      event_type: 'audit.fact',
      event_version: 2,
      producer: 'iam',
      resource: { type: 'iam.user', id: 'user-2', sequence: 3 },
      payload: {
        actor: { type: 'user', id: 'admin-1' },
        action: 'iam.user.permissions_changed',
        changes: [
          {
            field: 'additional_permissions',
            before: [],
            after: ['maintenance:verify'],
          },
        ],
      },
    });
  });

  /** An administrator cannot change their own additional permission grants. */
  test('rejects self permission changes before persistence', async () => {
    const { service, store, append } = createHarness();

    await expect(
      service.replaceAdditionalPermissions({
        actorUserId: 'user-2',
        userId: 'user-2',
        permissions: ['maintenance:verify'],
      }),
    ).rejects.toBeInstanceOf(SelfUserPermissionChangeError);

    expect(store.replacePermissions).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  /** The last active IT Admin cannot be disabled. */
  test('rejects disabling the last active IT Admin', async () => {
    const admin = {
      userId: 'user-2',
      username: 'Admin',
      email: 'admin@example.test',
      displayName: null,
      role: 'IT_ADMIN' as const,
      status: 'ACTIVE' as const,
      additionalPermissions: [] as const,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
      auditSequence: 2,
    };
    const { service, store, append } = createHarness({
      findUser: jest.fn().mockResolvedValue(admin),
      countActiveItAdmins: jest.fn().mockResolvedValue(1),
    });

    await expect(
      service.setStatus({
        actorUserId: 'admin-1',
        userId: 'user-2',
        status: 'INACTIVE',
      }),
    ).rejects.toBeInstanceOf(LastActiveItAdminError);

    expect(store.setStatus).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  /** Role replacement clears prior grants and places both changes in v2. */
  test('replaces a role and clears grants in the same v2 fact', async () => {
    const user = {
      userId: 'user-2',
      username: 'Technician',
      email: 'tech@example.test',
      displayName: null,
      role: 'TECHNICIAN' as const,
      status: 'ACTIVE' as const,
      additionalPermissions: ['incident:read'] as const,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
      auditSequence: 2,
    };
    const { service, store, appendedFacts } = createHarness({
      findUser: jest.fn().mockResolvedValue(user),
    });

    await service.replaceRole({
      actorUserId: 'admin-1',
      userId: 'user-2',
      role: 'OPERATOR',
    });

    expect(store.replaceRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'OPERATOR', expectedSequence: 2 }),
      context,
    );
    expect(appendedFacts[0]).toMatchObject({
      event_version: 2,
      payload: {
        action: 'iam.user.role_changed',
        changes: [
          { field: 'role', before: 'TECHNICIAN', after: 'OPERATOR' },
          {
            field: 'additional_permissions',
            before: ['incident:read'],
            after: [],
          },
        ],
      },
    });
  });

  /** Explicit role replacement clears stale extra grants even when the role is unchanged. */
  test('clears extra grants when the requested role matches the current role', async () => {
    const user = {
      userId: 'user-2',
      username: 'Technician',
      email: 'tech@example.test',
      displayName: null,
      role: 'TECHNICIAN' as const,
      status: 'ACTIVE' as const,
      additionalPermissions: ['incident:read'] as const,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
      auditSequence: 2,
    };
    const { service, store, appendedFacts } = createHarness({
      findUser: jest.fn().mockResolvedValue(user),
    });

    await service.replaceRole({
      actorUserId: 'admin-1',
      userId: 'user-2',
      role: 'TECHNICIAN',
    });

    expect(store.replaceRole).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'TECHNICIAN', expectedSequence: 2 }),
      context,
    );
    expect(appendedFacts[0]).toMatchObject({
      event_version: 2,
      payload: {
        action: 'iam.user.permissions_changed',
        changes: [
          {
            field: 'additional_permissions',
            before: ['incident:read'],
            after: [],
          },
        ],
      },
    });
  });

  /** Disabling a user and revoking all active sessions share one transaction. */
  test('disables a user and revokes sessions atomically with a v1 fact', async () => {
    const { service, store, appendedFacts } = createHarness();

    await service.setStatus({
      actorUserId: 'admin-1',
      userId: 'user-2',
      status: 'INACTIVE',
    });

    expect(store.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'INACTIVE', expectedSequence: 2 }),
      context,
    );
    expect(store.revokeSessions).toHaveBeenCalledWith('user-2', now, context);
    expect(appendedFacts[0]).toMatchObject({
      event_version: 1,
      payload: {
        action: 'iam.user.status_changed',
        changes: [{ field: 'status', before: 'ACTIVE', after: 'INACTIVE' }],
      },
    });
  });

  /** Password reset returns a one-time secret but records only a sanitized fact. */
  test('resets credentials and revokes sessions without auditing secrets', async () => {
    const { service, store, appendedFacts } = createHarness();

    await expect(
      service.resetPassword({ actorUserId: 'admin-1', userId: 'user-2' }),
    ).resolves.toEqual({
      temporaryPassword: 'temporary-credential',
      mustChangePassword: true,
    });

    expect(store.resetCredential).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'hashed-temporary-credential' }),
      context,
    );
    expect(store.revokeSessions).toHaveBeenCalledWith('user-2', now, context);
    const fact = appendedFacts[0];
    expect(fact).toMatchObject({
      event_version: 1,
      payload: { action: 'iam.credential.reset' },
    });
    expect(JSON.stringify(fact)).not.toContain('temporary-credential');
    expect(JSON.stringify(fact)).not.toContain('hashed-temporary-credential');
  });

  /** A profile update that changes no fields does not write or append a fact. */
  test('does not audit a no-op profile update', async () => {
    const { service, store, append } = createHarness();

    await service.updateProfile({
      actorUserId: 'admin-1',
      userId: 'user-2',
      username: 'Technician',
      email: 'tech@example.test',
    });

    expect(store.updateProfile).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  /** Cursor listing returns one page and a continuation from its last item. */
  test('lists users with a stable user-ID continuation cursor', async () => {
    const first = { ...createHarness().user, userId: 'user-1' };
    const second = { ...createHarness().user, userId: 'user-2' };
    const third = { ...createHarness().user, userId: 'user-3' };
    const { service, store } = createHarness({
      listUsers: jest.fn().mockResolvedValue({
        items: [first, second, third],
        hasMore: false,
      }),
    });

    await expect(
      service.listUsers({ pageSize: 2, afterUserId: 'user-0' }),
    ).resolves.toMatchObject({
      users: [{ id: 'user-1' }, { id: 'user-2' }],
      nextCursorUserId: 'user-2',
    });
    expect(store.listUsers).toHaveBeenCalledWith({
      afterUserId: 'user-0',
      limit: 3,
    });
  });

  /** A stale sequence reruns the entire transaction and reloads the user. */
  test('retries a complete permission mutation after OCC conflicts', async () => {
    const replacePermissions = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(3);
    const { service, store, append, unitOfWork } = createHarness({
      replacePermissions,
    });

    await service.replaceAdditionalPermissions({
      actorUserId: 'admin-1',
      userId: 'user-2',
      permissions: ['maintenance:verify'],
    });

    expect(store.findUser).toHaveBeenCalledTimes(3);
    expect(unitOfWork.run).toHaveBeenCalledTimes(3);
    expect(append).toHaveBeenCalledTimes(1);
  });

  /** Repeated OCC conflicts stop after three full transactions and append no fact. */
  test('returns a stable conflict after three OCC attempts', async () => {
    const replacePermissions = jest.fn().mockResolvedValue(null);
    const { service, store, append, unitOfWork } = createHarness({
      replacePermissions,
    });

    await expect(
      service.replaceAdditionalPermissions({
        actorUserId: 'admin-1',
        userId: 'user-2',
        permissions: ['maintenance:verify'],
      }),
    ).rejects.toThrow('User changed concurrently; retry the request');

    expect(store.findUser).toHaveBeenCalledTimes(3);
    expect(unitOfWork.run).toHaveBeenCalledTimes(3);
    expect(append).not.toHaveBeenCalled();
  });
});

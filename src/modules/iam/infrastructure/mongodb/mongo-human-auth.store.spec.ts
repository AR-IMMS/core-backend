import {
  MongoHumanAuthStore,
  type MongoHumanAccountModel,
  type MongoHumanSessionModel,
} from './mongo-human-auth.store';

describe('MongoHumanAuthStore', () => {
  /** It searches username and email by the same normalized identifier. */
  test('finds a credential record by normalized username or email', async () => {
    const findOne = jest.fn().mockReturnValue(
      query({
        userId: 'u-1',
        username: 'Operator',
        email: 'operator@example.test',
        normalizedUsername: 'operator',
        normalizedEmail: 'operator@example.test',
        displayName: null,
        role: 'OPERATOR',
        status: 'ACTIVE',
        additionalPermissions: [],
        passwordHash: 'argon-hash',
        mustChangePassword: false,
        auditSequence: 0,
      }),
    );
    const store = new MongoHumanAuthStore(
      { findOne } as unknown as MongoHumanAccountModel,
      {} as MongoHumanSessionModel,
    );

    await expect(store.findByIdentifier(' operator ')).resolves.toMatchObject({
      userId: 'u-1',
      passwordHash: 'argon-hash',
    });
    expect(findOne).toHaveBeenCalledWith({
      status: 'ACTIVE',
      $or: [
        { normalizedUsername: 'operator' },
        { normalizedEmail: 'operator' },
      ],
    });
  });

  /** It creates the bootstrap account as an active IT Admin requiring first-use password change. */
  test('creates only a password hash and forces an initial password change', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const store = new MongoHumanAuthStore(
      { create } as unknown as MongoHumanAccountModel,
      {} as MongoHumanSessionModel,
    );

    await store.createInitialAdmin(
      {
        userId: 'admin-1',
        username: 'ITAdmin',
        normalizedUsername: 'itadmin',
        email: 'ADMIN@example.test',
        normalizedEmail: 'admin@example.test',
        passwordHash: 'argon-hash',
        displayName: null,
        auditSequence: 0,
      },
      {} as never,
    );

    expect(create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          userId: 'admin-1',
          normalizedUsername: 'itadmin',
          email: 'admin@example.test',
          normalizedEmail: 'admin@example.test',
          role: 'IT_ADMIN',
          status: 'ACTIVE',
          presencePreference: 'AUTOMATIC',
          passwordHash: 'argon-hash',
          mustChangePassword: true,
          auditSequence: 0,
        }),
      ],
      { session: {} },
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain('plaintext');
  });

  /** It stores provisioned account credentials only as a hash and inside the Unit of Work. */
  test('creates a user with forced password change and the transaction session', async () => {
    const context = {};
    const create = jest.fn().mockResolvedValue(undefined);
    const store = new MongoHumanAuthStore(
      { create } as unknown as MongoHumanAccountModel,
      {} as MongoHumanSessionModel,
    );

    await store.createProvisionedUser(
      {
        userId: 'user-1',
        username: 'Operator',
        normalizedUsername: 'operator',
        email: 'operator@example.test',
        normalizedEmail: 'operator@example.test',
        displayName: null,
        role: 'OPERATOR',
        passwordHash: 'argon-hash',
        auditSequence: 0,
      },
      context as never,
    );

    expect(create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          userId: 'user-1',
          role: 'OPERATOR',
          status: 'ACTIVE',
          passwordHash: 'argon-hash',
          mustChangePassword: true,
          auditSequence: 0,
        }),
      ],
      { session: context },
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain('plaintext');
  });

  /** It allocates a resource sequence with a version check inside the transaction. */
  test('increments only when the expected user sequence still matches', async () => {
    const context = {};
    const updateOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    });
    const store = new MongoHumanAuthStore(
      { updateOne } as unknown as MongoHumanAccountModel,
      {} as MongoHumanSessionModel,
    );

    await expect(
      store.allocateAuditSequence('admin-1', 0, context as never),
    ).resolves.toBe(1);
    expect(updateOne).toHaveBeenCalledWith(
      { userId: 'admin-1', auditSequence: 0 },
      { $inc: { auditSequence: 1 } },
      { session: context },
    );
  });

  /** It reports stale sequence versions without allocating a duplicate value. */
  test('reports a compare-and-update conflict', async () => {
    const updateOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ matchedCount: 0 }),
    });
    const store = new MongoHumanAuthStore(
      { updateOne } as unknown as MongoHumanAccountModel,
      {} as MongoHumanSessionModel,
    );

    await expect(
      store.allocateAuditSequence('admin-1', 3, {} as never),
    ).resolves.toBeNull();
  });

  /** It updates the password only when the account version matches in the active transaction. */
  test('changes the password and increments the sequence with one OCC update', async () => {
    const context = {};
    const updateOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    });
    const store = new MongoHumanAuthStore(
      { updateOne } as unknown as MongoHumanAccountModel,
      {} as MongoHumanSessionModel,
    );

    await expect(
      store.updatePasswordWithAuditSequence(
        {
          userId: 'user-1',
          expectedSequence: 1,
          passwordHash: 'argon-hash',
          changedAt: new Date('2026-10-15T12:00:00.000Z'),
        },
        context as never,
      ),
    ).resolves.toBe(2);
    expect(updateOne).toHaveBeenCalledWith(
      { userId: 'user-1', status: 'ACTIVE', auditSequence: 1 },
      {
        $set: {
          passwordHash: 'argon-hash',
          mustChangePassword: false,
          passwordChangedAt: new Date('2026-10-15T12:00:00.000Z'),
        },
        $inc: { auditSequence: 1 },
      },
      { session: context },
    );
  });
});

function query<T>(result: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(result) }),
  };
}

import { MongoHumanSessionAccessStore } from './mongo-human-session-access.store';

describe('MongoHumanSessionAccessStore', () => {
  /** It returns an active principal only when both account and session are current. */
  test('resolves a principal with its forced-password-change state', async () => {
    const userFind = makeQuery({
      userId: 'u-1',
      username: 'operator',
      email: 'operator@example.test',
      displayName: null,
      role: 'OPERATOR',
      status: 'ACTIVE',
      additionalPermissions: ['maintenance:execute'],
      presencePreference: 'BUSY',
      mustChangePassword: true,
    });
    const sessionFind = makeQuery({ sessionId: 's-1' });
    const store = new MongoHumanSessionAccessStore(
      { findOne: userFind.findOne },
      { findOne: sessionFind.findOne },
    );
    const now = new Date('2026-10-15T12:00:00Z');

    const principal = await store.getActivePrincipal('u-1', 's-1', now);
    expect(principal).toMatchObject({
      userId: 'u-1',
      role: 'OPERATOR',
      status: 'ACTIVE',
      sessionId: 's-1',
      mustChangePassword: true,
      username: 'operator',
      email: 'operator@example.test',
      displayName: null,
      presencePreference: 'BUSY',
    });
    expect(principal?.effectivePermissions).toContain('maintenance:execute');
    expect(userFind.findOne).toHaveBeenCalledWith({
      userId: 'u-1',
      status: 'ACTIVE',
    });
    expect(sessionFind.findOne).toHaveBeenCalledWith({
      userId: 'u-1',
      sessionId: 's-1',
      revokedAt: null,
      expiresAt: { $gt: now },
    });
  });

  /** It rejects a principal when the account or session query finds no active record. */
  test('returns null when either account or session is unavailable', async () => {
    const userFind = makeQuery(null);
    const sessionFind = makeQuery({ sessionId: 's-1' });
    const store = new MongoHumanSessionAccessStore(
      { findOne: userFind.findOne },
      { findOne: sessionFind.findOne },
    );

    await expect(
      store.getActivePrincipal('u-1', 's-1', new Date()),
    ).resolves.toBeNull();
    expect(sessionFind.findOne).not.toHaveBeenCalled();
  });
});

function makeQuery(result: unknown) {
  const findOne = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    lean: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(result) }),
  });
  return { findOne };
}

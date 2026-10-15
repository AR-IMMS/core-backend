import {
  MongoUserPresenceStore,
  type MongoUserPresenceModel,
  type MongoUserSessionModel,
} from './mongo-user-presence.store';

describe('MongoUserPresenceStore', () => {
  /** It renews only the matching active, unexpired session using server-derived expiry. */
  test('updates the lease only for the current valid user session', async () => {
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ sessionId: 's-1' }),
    });
    const store = new MongoUserPresenceStore(
      {} as MongoUserPresenceModel,
      { findOneAndUpdate } as unknown as MongoUserSessionModel,
    );
    const now = new Date('2026-10-15T12:00:00Z');
    const leaseExpiresAt = new Date('2026-10-15T12:01:30Z');

    await expect(
      store.renewPresenceLease({
        userId: 'u-1',
        sessionId: 's-1',
        now,
        leaseExpiresAt,
      }),
    ).resolves.toBe(true);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        userId: 'u-1',
        sessionId: 's-1',
        revokedAt: null,
        expiresAt: { $gt: now },
      },
      { $set: { presenceLeaseExpiresAt: leaseExpiresAt } },
      { new: true },
    );
  });

  /** It refuses to renew a session if the atomic active-session match fails. */
  test('returns false when a session is expired or revoked', async () => {
    const findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const store = new MongoUserPresenceStore(
      {} as MongoUserPresenceModel,
      { findOneAndUpdate } as unknown as MongoUserSessionModel,
    );

    await expect(
      store.renewPresenceLease({
        userId: 'u-1',
        sessionId: 's-1',
        now: new Date('2026-10-15T12:00:00Z'),
        leaseExpiresAt: new Date('2026-10-15T12:01:30Z'),
      }),
    ).resolves.toBe(false);
  });
});

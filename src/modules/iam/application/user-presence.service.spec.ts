import type { UserPresenceStorePort } from './ports/user-presence-store.port';
import { UserPresenceService } from './user-presence.service';

describe('UserPresenceService', () => {
  /** It renews the authenticated session lease using server time and configured duration. */
  test('renews only the supplied principal session lease', async () => {
    const store: UserPresenceStorePort = {
      renewPresenceLease: jest.fn().mockResolvedValue(true),
      setPresencePreference: jest.fn(),
      getPresenceInputs: jest.fn(),
    };
    const now = new Date('2026-10-15T12:00:00Z');
    const service = new UserPresenceService(store, 90_000, () => now);

    await expect(
      service.renewCurrentSessionLease({ userId: 'u-1', sessionId: 's-1' }),
    ).resolves.toBeUndefined();
    expect(jest.mocked(store.renewPresenceLease)).toHaveBeenCalledWith({
      userId: 'u-1',
      sessionId: 's-1',
      now,
      leaseExpiresAt: new Date('2026-10-15T12:01:30Z'),
    });
  });

  /** It returns offline for missing candidates while deriving known user presence. */
  test('returns offline for missing users and derives known candidate statuses', async () => {
    const store: UserPresenceStorePort = {
      renewPresenceLease: jest.fn(),
      setPresencePreference: jest.fn(),
      getPresenceInputs: jest.fn().mockResolvedValue([
        {
          userId: 'u-1',
          accountStatus: 'ACTIVE',
          preference: 'BUSY',
          hasLiveLease: true,
        },
      ]),
    };
    const service = new UserPresenceService(store, 90_000, () => new Date());

    await expect(
      service.getPresence(['u-1', 'missing', 'u-1']),
    ).resolves.toEqual([
      { userId: 'u-1', status: 'BUSY' },
      { userId: 'missing', status: 'OFFLINE' },
    ]);
  });

  /** It rejects a heartbeat when persistence confirms the session is no longer valid. */
  test('rejects a heartbeat for an expired or revoked session', async () => {
    const store: UserPresenceStorePort = {
      renewPresenceLease: jest.fn().mockResolvedValue(false),
      setPresencePreference: jest.fn(),
      getPresenceInputs: jest.fn(),
    };
    const service = new UserPresenceService(store, 90_000);

    await expect(
      service.renewCurrentSessionLease({ userId: 'u-1', sessionId: 's-1' }),
    ).rejects.toThrow('Session is not active');
  });
});

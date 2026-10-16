import { resolveUserPresence } from './user-presence';

describe('IAM user presence', () => {
  /** It derives ONLINE for an active leased user with the automatic preference. */
  test('resolves automatic preference to online while a session lease is live', () => {
    expect(
      resolveUserPresence({
        accountStatus: 'ACTIVE',
        preference: 'AUTOMATIC',
        hasLiveLease: true,
      }),
    ).toBe('ONLINE');
  });

  /** It preserves a user's busy or away choice while any device lease is live. */
  test.each([
    ['BUSY', 'BUSY'],
    ['AWAY', 'AWAY'],
  ] as const)(
    'resolves %s preference to %s while a session lease is live',
    (preference, expected) => {
      expect(
        resolveUserPresence({
          accountStatus: 'ACTIVE',
          preference,
          hasLiveLease: true,
        }),
      ).toBe(expected);
    },
  );

  /** It reports offline when every session lease has expired or been revoked. */
  test('resolves offline without a live session lease regardless of preference', () => {
    expect(
      resolveUserPresence({
        accountStatus: 'ACTIVE',
        preference: 'BUSY',
        hasLiveLease: false,
      }),
    ).toBe('OFFLINE');
  });

  /** It never reports active presence for an inactive account with stale leases. */
  test('resolves offline for an inactive account even with a live lease', () => {
    expect(
      resolveUserPresence({
        accountStatus: 'INACTIVE',
        preference: 'AWAY',
        hasLiveLease: true,
      }),
    ).toBe('OFFLINE');
  });
});

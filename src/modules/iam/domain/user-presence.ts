import type { UserStatus } from './user';

/** Effective availability derived from account state, leases, and preference. */
export type UserPresenceStatus = 'ONLINE' | 'BUSY' | 'AWAY' | 'OFFLINE';

/** User-controlled availability preference shared across authenticated devices. */
export type UserPresencePreference = 'AUTOMATIC' | 'BUSY' | 'AWAY';

/** Inputs required to derive availability without exposing session details. */
export interface ResolveUserPresenceInput {
  readonly accountStatus: UserStatus;
  readonly preference: UserPresencePreference;
  readonly hasLiveLease: boolean;
}

/** Resolves a user's effective availability using account status and live leases. */
export function resolveUserPresence({
  accountStatus,
  preference,
  hasLiveLease,
}: ResolveUserPresenceInput): UserPresenceStatus {
  if (accountStatus !== 'ACTIVE' || !hasLiveLease) {
    return 'OFFLINE';
  }

  return preference === 'AUTOMATIC' ? 'ONLINE' : preference;
}

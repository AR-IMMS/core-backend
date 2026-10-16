import type {
  UserPresencePreference,
  UserPresenceStatus,
} from '../domain/user-presence';
import { resolveUserPresence } from '../domain/user-presence';
import type {
  UserPresencePort,
  UserPresenceView,
} from './ports/user-presence.port';
import type { UserPresenceStorePort } from './ports/user-presence-store.port';

/** Raised when a preference update targets a user no longer present in IAM. */
export class UserPresenceUserNotFoundError extends Error {
  constructor() {
    super('IAM user was not found');
    this.name = 'UserPresenceUserNotFoundError';
  }
}

/** Raised when a heartbeat cannot renew the authenticated session's lease. */
export class InactivePresenceSessionError extends Error {
  constructor() {
    super('Session is not active');
    this.name = 'InactivePresenceSessionError';
  }
}

/** Implements lease renewal, self-service preference, and candidate lookup. */
export class UserPresenceService implements UserPresencePort {
  constructor(
    private readonly store: UserPresenceStorePort,
    private readonly leaseDurationMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new Error('Presence lease duration must be a positive integer');
    }
  }

  async renewCurrentSessionLease(input: {
    readonly userId: string;
    readonly sessionId: string;
  }): Promise<void> {
    const now = this.now();
    const renewed = await this.store.renewPresenceLease({
      ...input,
      now,
      leaseExpiresAt: new Date(now.getTime() + this.leaseDurationMs),
    });
    if (!renewed) throw new InactivePresenceSessionError();
  }

  async setCurrentUserPreference(
    userId: string,
    preference: UserPresencePreference,
  ): Promise<UserPresenceView> {
    const updated = await this.store.setPresencePreference(userId, preference);
    if (!updated) throw new UserPresenceUserNotFoundError();
    return (
      (await this.getPresence([userId]))[0] ?? {
        userId,
        status: 'OFFLINE' satisfies UserPresenceStatus,
      }
    );
  }

  async getPresence(
    candidateUserIds: readonly string[],
  ): Promise<readonly UserPresenceView[]> {
    const uniqueUserIds = [...new Set(candidateUserIds)];
    if (uniqueUserIds.length === 0) return [];
    const inputs = await this.store.getPresenceInputs(
      uniqueUserIds,
      this.now(),
    );
    const inputsById = new Map(inputs.map((input) => [input.userId, input]));

    return uniqueUserIds.map((userId) => {
      const input = inputsById.get(userId);
      return {
        userId,
        status: input
          ? resolveUserPresence(input)
          : ('OFFLINE' satisfies UserPresenceStatus),
      };
    });
  }
}

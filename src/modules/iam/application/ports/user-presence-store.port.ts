import type { UserStatus } from '../../domain/user';
import type { UserPresencePreference } from '../../domain/user-presence';

/** Minimal IAM account/session state needed to derive effective presence. */
export interface UserPresenceInput {
  readonly userId: string;
  readonly accountStatus: UserStatus;
  readonly preference: UserPresencePreference;
  readonly hasLiveLease: boolean;
}

/** IAM-owned persistence contract for presence preference and session leases. */
export interface UserPresenceStorePort {
  renewPresenceLease(
    this: void,
    input: {
      readonly userId: string;
      readonly sessionId: string;
      readonly now: Date;
      readonly leaseExpiresAt: Date;
    },
  ): Promise<boolean>;
  setPresencePreference(
    this: void,
    userId: string,
    preference: UserPresencePreference,
  ): Promise<boolean>;
  getPresenceInputs(
    this: void,
    userIds: readonly string[],
    now: Date,
  ): Promise<readonly UserPresenceInput[]>;
}

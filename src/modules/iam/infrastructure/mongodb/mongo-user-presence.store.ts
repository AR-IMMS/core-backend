import type { UserPresenceStorePort } from '../../application/ports/user-presence-store.port';
import type { UserPresencePreference } from '../../domain/user-presence';

interface UserPresenceDocument {
  readonly userId: string;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly presencePreference?: UserPresencePreference;
}

interface UserPresenceQuery {
  select(fields: string): UserPresenceQuery;
  lean(): { exec(): Promise<readonly UserPresenceDocument[]> };
}

/** Narrow user model API consumed by the IAM presence adapter. */
export interface MongoUserPresenceModel {
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): { exec(): Promise<{ matchedCount: number }> };
  find(filter: Record<string, unknown>): UserPresenceQuery;
}

interface SessionPresenceDocument {
  readonly userId: string;
}

interface SessionPresenceQuery {
  select(fields: string): SessionPresenceQuery;
  lean(): { exec(): Promise<readonly SessionPresenceDocument[]> };
}

interface SessionRenewQuery {
  exec(): Promise<{ readonly sessionId: string } | null>;
}

/** Narrow session model API consumed by the IAM presence adapter. */
export interface MongoUserSessionModel {
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { new: true },
  ): SessionRenewQuery;
  find(filter: Record<string, unknown>): SessionPresenceQuery;
}

/** Persists user preferences and session leases without crossing IAM ownership. */
export class MongoUserPresenceStore implements UserPresenceStorePort {
  constructor(
    private readonly userModel: MongoUserPresenceModel,
    private readonly sessionModel: MongoUserSessionModel,
  ) {}

  async renewPresenceLease(input: {
    readonly userId: string;
    readonly sessionId: string;
    readonly now: Date;
    readonly leaseExpiresAt: Date;
  }): Promise<boolean> {
    const renewed = await this.sessionModel
      .findOneAndUpdate(
        {
          userId: input.userId,
          sessionId: input.sessionId,
          revokedAt: null,
          expiresAt: { $gt: input.now },
        },
        { $set: { presenceLeaseExpiresAt: input.leaseExpiresAt } },
        { new: true },
      )
      .exec();
    return renewed !== null;
  }

  async setPresencePreference(
    userId: string,
    preference: UserPresencePreference,
  ): Promise<boolean> {
    const result = await this.userModel
      .updateOne({ userId }, { $set: { presencePreference: preference } })
      .exec();
    return result.matchedCount > 0;
  }

  async getPresenceInputs(userIds: readonly string[], now: Date) {
    if (userIds.length === 0) return [];

    const [users, sessions] = await Promise.all([
      this.userModel
        .find({ userId: { $in: [...new Set(userIds)] } })
        .select('userId status presencePreference')
        .lean()
        .exec(),
      this.sessionModel
        .find({
          userId: { $in: [...new Set(userIds)] },
          revokedAt: null,
          expiresAt: { $gt: now },
          presenceLeaseExpiresAt: { $gt: now },
        })
        .select('userId')
        .lean()
        .exec(),
    ]);
    const liveUserIds = new Set(sessions.map((session) => session.userId));

    return users.map((user) => ({
      userId: user.userId,
      accountStatus: user.status,
      preference: user.presencePreference ?? 'AUTOMATIC',
      hasLiveLease: liveUserIds.has(user.userId),
    }));
  }
}

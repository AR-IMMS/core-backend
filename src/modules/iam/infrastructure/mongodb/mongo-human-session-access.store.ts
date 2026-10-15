import type { HumanSessionAccessPort } from '../../application/ports/human-session-access.port';
import type { RoleCode } from '../../domain/role-permissions';
import type { UserStatus } from '../../domain/user';
import { createIamUser } from '../../domain/user';
import type { PermissionCode } from '../../domain/role-permissions';
import type { UserPresencePreference } from '../../domain/user-presence';

interface ActiveUserDocument {
  readonly userId: string;
  readonly username: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: RoleCode;
  readonly status: UserStatus;
  readonly additionalPermissions: readonly PermissionCode[];
  readonly presencePreference?: UserPresencePreference;
  readonly mustChangePassword: boolean;
}

interface ActiveSessionDocument {
  readonly sessionId: string;
}

interface ActiveRecordQuery<T> {
  select(fields: string): ActiveRecordQuery<T>;
  lean(): { exec(): Promise<T | null> };
}

/** Narrow user model API for verified principal resolution. */
export interface MongoHumanSessionAccessModel {
  findOne(
    filter: Record<string, unknown>,
  ): ActiveRecordQuery<ActiveUserDocument>;
}

/** Narrow session model API for verified principal resolution. */
export interface MongoHumanSessionModel {
  findOne(
    filter: Record<string, unknown>,
  ): ActiveRecordQuery<ActiveSessionDocument>;
}

/** Resolves access only when the account and server-side session are active. */
export class MongoHumanSessionAccessStore implements HumanSessionAccessPort {
  constructor(
    private readonly userModel: MongoHumanSessionAccessModel,
    private readonly sessionModel: MongoHumanSessionModel,
  ) {}

  async getActivePrincipal(userId: string, sessionId: string, now: Date) {
    const user = await this.userModel
      .findOne({ userId, status: 'ACTIVE' })
      .select(
        'userId username email displayName role status additionalPermissions presencePreference mustChangePassword',
      )
      .lean()
      .exec();
    if (!user) return null;

    const session = await this.sessionModel
      .findOne({
        userId,
        sessionId,
        revokedAt: null,
        expiresAt: { $gt: now },
      })
      .select('sessionId')
      .lean()
      .exec();
    if (!session) return null;

    const access = createIamUser({
      userId: user.userId,
      role: user.role,
      status: user.status,
      additionalPermissions: user.additionalPermissions,
      presencePreference: user.presencePreference ?? 'AUTOMATIC',
    });

    return {
      userId: user.userId,
      role: user.role,
      status: user.status,
      sessionId: session.sessionId,
      mustChangePassword: user.mustChangePassword,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      effectivePermissions: access.effectivePermissions,
      presencePreference: access.presencePreference,
    };
  }
}

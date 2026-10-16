import { createIamUser } from '../../domain/user';
import type { PermissionCode, RoleCode } from '../../domain/role-permissions';
import type { UserPresencePreference } from '../../domain/user-presence';
import type { UserStatus } from '../../domain/user';
import type { HumanAccessStorePort } from '../../application/ports/human-access-store.port';

interface HumanAccessDocument {
  readonly userId: string;
  readonly role: RoleCode;
  readonly status: UserStatus;
  readonly additionalPermissions: readonly PermissionCode[];
  readonly presencePreference?: UserPresencePreference;
}

interface HumanAccessQuery {
  select(fields: string): HumanAccessQuery;
  lean(): { exec(): Promise<HumanAccessDocument | null> };
}

/** Narrow user model API used to read current IAM access state. */
export interface MongoHumanAccessModel {
  findOne(filter: Record<string, unknown>): HumanAccessQuery;
}

/** Reads a user's live access state without selecting credentials or session data. */
export class MongoHumanAccessStore implements HumanAccessStorePort {
  constructor(private readonly userModel: MongoHumanAccessModel) {}

  async findByUserId(userId: string) {
    const document = await this.userModel
      .findOne({ userId })
      .select('userId role status additionalPermissions presencePreference')
      .lean()
      .exec();
    if (!document) return null;

    return createIamUser({
      userId: document.userId,
      role: document.role,
      status: document.status,
      additionalPermissions: document.additionalPermissions,
      presencePreference: document.presencePreference ?? 'AUTOMATIC',
    });
  }
}

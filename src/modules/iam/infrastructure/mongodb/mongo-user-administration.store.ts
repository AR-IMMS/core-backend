import type { ClientSession } from 'mongoose';

import type { UnitOfWorkContext } from '@platform/events';
import type { PermissionCode, RoleCode } from '../../domain/role-permissions';
import type { UserStatus } from '../../domain/user';
import type {
  ManagedHumanUser,
  UserAdministrationStorePort,
} from '../../application/ports/user-administration-store.port';

interface UserDocument extends ManagedHumanUser {
  readonly normalizedUsername: string;
  readonly normalizedEmail: string;
}

interface UserQuery<TResult> {
  sort(sort: Record<string, 1 | -1>): UserQuery<TResult>;
  limit(limit: number): UserQuery<TResult>;
  select(fields: string): UserQuery<TResult>;
  session(session: ClientSession): UserQuery<TResult>;
  lean(): { exec(): Promise<TResult> };
  exec(): Promise<TResult>;
}

interface CountQuery {
  session(session: ClientSession): CountQuery;
  exec(): Promise<number>;
}

interface WriteQuery {
  exec(): Promise<{
    readonly matchedCount?: number;
    readonly modifiedCount?: number;
  }>;
}

/** Narrow Mongoose model surface required by IAM administration. */
export interface MongoUserAdministrationModel {
  findOne(filter: Record<string, unknown>): UserQuery<UserDocument | null>;
  find(filter: Record<string, unknown>): UserQuery<UserDocument[]>;
  countDocuments(filter: Record<string, unknown>): CountQuery;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: {
      readonly session?: ClientSession;
      readonly timestamps?: boolean;
    },
  ): WriteQuery;
}

interface SessionWriteQuery {
  exec(): Promise<{
    readonly matchedCount?: number;
    readonly modifiedCount?: number;
  }>;
}

/** Narrow session model surface required by user administration. */
export interface MongoUserAdministrationSessionModel {
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: {
      readonly session?: ClientSession;
      readonly timestamps?: boolean;
    },
  ): SessionWriteQuery;
}

const USER_PUBLIC_FIELDS =
  'userId username email displayName role status additionalPermissions mustChangePassword createdAt updatedAt auditSequence';

/** Mongo adapter for IAM directory, account mutations, and session revocation. */
export class MongoUserAdministrationStore implements UserAdministrationStorePort {
  constructor(
    private readonly userModel: MongoUserAdministrationModel,
    private readonly sessionModel: MongoUserAdministrationSessionModel,
  ) {}

  async findUser(userId: string, context?: UnitOfWorkContext) {
    let query = this.userModel.findOne({ userId });
    if (context) query = query.session(context as unknown as ClientSession);
    const user = await query.select(USER_PUBLIC_FIELDS).lean().exec();
    return user ? toManagedUser(user) : null;
  }

  async listUsers(input: {
    readonly afterUserId?: string;
    readonly limit: number;
  }) {
    const filter = input.afterUserId
      ? { userId: { $gt: input.afterUserId } }
      : {};
    const users = await this.userModel
      .find(filter)
      .sort({ userId: 1 })
      .limit(input.limit)
      .select(USER_PUBLIC_FIELDS)
      .lean()
      .exec();
    return { items: users.map(toManagedUser), hasMore: false };
  }

  countActiveItAdmins(context: UnitOfWorkContext): Promise<number> {
    return this.userModel
      .countDocuments({ role: 'IT_ADMIN', status: 'ACTIVE' })
      .session(context as unknown as ClientSession)
      .exec();
  }

  async guardActiveAdminSet(
    excludingUserId: string,
    context: UnitOfWorkContext,
  ): Promise<boolean> {
    const admin = await this.userModel
      .findOne({
        role: 'IT_ADMIN',
        status: 'ACTIVE',
        userId: { $ne: excludingUserId },
      })
      .session(context as unknown as ClientSession)
      .sort({ userId: 1 })
      .select('userId')
      .lean()
      .exec();
    if (!admin) return false;
    const result = await this.userModel
      .updateOne(
        { userId: admin.userId, role: 'IT_ADMIN', status: 'ACTIVE' },
        { $inc: { adminGuardVersion: 1 } },
        { session: context as unknown as ClientSession, timestamps: false },
      )
      .exec();
    return getMatchedCount(result) === 1;
  }

  updateProfile(
    input: {
      readonly userId: string;
      readonly expectedSequence: number;
      readonly username?: string;
      readonly normalizedUsername?: string;
      readonly email?: string;
      readonly normalizedEmail?: string;
      readonly displayName?: string | null;
      readonly updatedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<number | null> {
    return this.conditionalUserUpdate(
      input.userId,
      input.expectedSequence,
      {
        ...(input.username === undefined ? {} : { username: input.username }),
        ...(input.normalizedUsername === undefined
          ? {}
          : { normalizedUsername: input.normalizedUsername }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.normalizedEmail === undefined
          ? {}
          : { normalizedEmail: input.normalizedEmail }),
        ...(input.displayName === undefined
          ? {}
          : { displayName: input.displayName }),
        updatedAt: input.updatedAt,
      },
      context,
    );
  }

  replaceRole(
    input: {
      readonly userId: string;
      readonly expectedSequence: number;
      readonly role: RoleCode;
      readonly updatedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<number | null> {
    return this.conditionalUserUpdate(
      input.userId,
      input.expectedSequence,
      {
        role: input.role,
        additionalPermissions: [],
        updatedAt: input.updatedAt,
      },
      context,
    );
  }

  replacePermissions(
    input: {
      readonly userId: string;
      readonly expectedSequence: number;
      readonly additionalPermissions: readonly PermissionCode[];
      readonly updatedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<number | null> {
    return this.conditionalUserUpdate(
      input.userId,
      input.expectedSequence,
      {
        additionalPermissions: [...input.additionalPermissions],
        updatedAt: input.updatedAt,
      },
      context,
    );
  }

  setStatus(
    input: {
      readonly userId: string;
      readonly expectedSequence: number;
      readonly status: UserStatus;
      readonly updatedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<number | null> {
    return this.conditionalUserUpdate(
      input.userId,
      input.expectedSequence,
      { status: input.status, updatedAt: input.updatedAt },
      context,
    );
  }

  resetCredential(
    input: {
      readonly userId: string;
      readonly expectedSequence: number;
      readonly passwordHash: string;
      readonly changedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<number | null> {
    return this.conditionalUserUpdate(
      input.userId,
      input.expectedSequence,
      {
        passwordHash: input.passwordHash,
        mustChangePassword: true,
        passwordChangedAt: null,
        updatedAt: input.changedAt,
      },
      context,
    );
  }

  async revokeSessions(
    userId: string,
    at: Date,
    context: UnitOfWorkContext,
  ): Promise<number> {
    const result = await this.sessionModel
      .updateMany(
        { userId, revokedAt: null },
        { $set: { revokedAt: at, presenceLeaseExpiresAt: null } },
        { session: context as unknown as ClientSession, timestamps: false },
      )
      .exec();
    return result.modifiedCount ?? result.matchedCount ?? 0;
  }

  async allocateAuditSequence(
    userId: string,
    expectedSequence: number,
    occurredAt: Date,
    context: UnitOfWorkContext,
  ): Promise<number | null> {
    const result = await this.userModel
      .updateOne(
        { userId, auditSequence: expectedSequence },
        { $set: { updatedAt: occurredAt }, $inc: { auditSequence: 1 } },
        { session: context as unknown as ClientSession, timestamps: false },
      )
      .exec();
    return getMatchedCount(result) === 1 ? expectedSequence + 1 : null;
  }

  private async conditionalUserUpdate(
    userId: string,
    expectedSequence: number,
    changes: Record<string, unknown>,
    context: UnitOfWorkContext,
  ): Promise<number | null> {
    const result = await this.userModel
      .updateOne(
        { userId, auditSequence: expectedSequence },
        { $set: changes, $inc: { auditSequence: 1 } },
        { session: context as unknown as ClientSession, timestamps: false },
      )
      .exec();
    return getMatchedCount(result) === 1 ? expectedSequence + 1 : null;
  }
}

function toManagedUser(user: UserDocument): ManagedHumanUser {
  return {
    userId: user.userId,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    additionalPermissions: user.additionalPermissions,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    auditSequence: user.auditSequence,
  };
}

function getMatchedCount(result: {
  readonly matchedCount?: number;
  readonly modifiedCount?: number;
}): number {
  return result.matchedCount ?? result.modifiedCount ?? 0;
}

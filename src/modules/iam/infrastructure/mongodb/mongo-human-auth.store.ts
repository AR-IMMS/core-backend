import type {
  HumanAuthStorePort,
  HumanSessionStorePort,
} from '../../application/ports/human-auth-store.port';
import type { UnitOfWorkContext } from '@platform/events';
import type { ClientSession } from 'mongoose';
import type { PermissionCode } from '../../domain/role-permissions';

interface HumanAccountDocument {
  readonly userId: string;
  readonly username: string;
  readonly email: string;
  readonly normalizedUsername: string;
  readonly normalizedEmail: string;
  readonly displayName: string | null;
  readonly role: 'IT_ADMIN' | 'OPERATOR' | 'TECHNICIAN';
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly additionalPermissions: readonly PermissionCode[];
  readonly passwordHash: string;
  readonly mustChangePassword: boolean;
  readonly auditSequence: number;
}

interface AccountQuery {
  select(fields: string): AccountQuery;
  session(session: ClientSession): AccountQuery;
  lean(): { exec(): Promise<HumanAccountDocument | null> };
}

interface WriteQuery {
  exec(): Promise<{ matchedCount: number } | number>;
}

interface CountQuery {
  session(session: ClientSession): CountQuery;
  exec(): Promise<number>;
}

/** Narrow account model API used by IAM authentication operations. */
export interface MongoHumanAccountModel {
  findOne(filter: Record<string, unknown>): AccountQuery;
  countDocuments(filter: Record<string, unknown>): CountQuery;
  create(
    documents: readonly Record<string, unknown>[],
    options: { session: ClientSession },
  ): Promise<unknown>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { session?: ClientSession },
  ): WriteQuery;
}

interface SessionDocument {
  readonly sessionId: string;
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly usedRefreshTokenHashes: readonly string[];
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

interface SessionQuery {
  select(fields: string): SessionQuery;
  lean(): { exec(): Promise<SessionDocument | null> };
  exec(): Promise<SessionDocument | null>;
}

/** Narrow session model API used by IAM authentication operations. */
export interface MongoHumanSessionModel {
  create(documents: readonly Record<string, unknown>[]): Promise<unknown>;
  findOne(filter: Record<string, unknown>): SessionQuery;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { new: true },
  ): SessionQuery;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): WriteQuery;
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { session?: ClientSession },
  ): WriteQuery;
}

/** Mongo adapter for IAM credentials, bootstrap, refresh rotation, and revocation. */
export class MongoHumanAuthStore
  implements HumanAuthStorePort, HumanSessionStorePort
{
  constructor(
    private readonly userModel: MongoHumanAccountModel,
    private readonly sessionModel: MongoHumanSessionModel,
  ) {}

  async findByIdentifier(identifier: string) {
    const normalizedIdentifier = identifier.trim().toLowerCase();
    const user = await this.userModel
      .findOne({
        status: 'ACTIVE',
        $or: [
          { normalizedUsername: normalizedIdentifier },
          { normalizedEmail: normalizedIdentifier },
        ],
      })
      .select('+passwordHash')
      .lean()
      .exec();
    return user ? toCredentialRecord(user) : null;
  }

  async findByUserId(userId: string, context?: UnitOfWorkContext) {
    let query = this.userModel.findOne({ userId });
    if (context) query = query.session(context as unknown as ClientSession);
    const user = await query.select('+passwordHash').lean().exec();
    return user ? toCredentialRecord(user) : null;
  }

  async hasAnyItAdmin(context: UnitOfWorkContext): Promise<boolean> {
    return (
      (await this.userModel
        .countDocuments({ role: 'IT_ADMIN' })
        .session(context as unknown as ClientSession)
        .exec()) > 0
    );
  }

  async createInitialAdmin(
    input: {
      readonly userId: string;
      readonly username: string;
      readonly normalizedUsername: string;
      readonly email: string;
      readonly normalizedEmail: string;
      readonly passwordHash: string;
      readonly displayName: string | null;
      readonly auditSequence: 0;
    },
    context: UnitOfWorkContext,
  ): Promise<void> {
    const username = input.username.trim();
    const email = input.email.trim().toLowerCase();
    await this.userModel.create(
      [
        {
          userId: input.userId,
          username,
          email,
          normalizedUsername: username.toLowerCase(),
          normalizedEmail: email,
          displayName: input.displayName,
          role: 'IT_ADMIN',
          status: 'ACTIVE',
          additionalPermissions: [],
          presencePreference: 'AUTOMATIC',
          passwordHash: input.passwordHash,
          mustChangePassword: true,
          passwordChangedAt: null,
          auditSequence: input.auditSequence,
          bootstrapKey: 'initial-it-admin',
        },
      ],
      { session: context as unknown as ClientSession },
    );
  }

  async createProvisionedUser(
    input: {
      readonly userId: string;
      readonly username: string;
      readonly normalizedUsername: string;
      readonly email: string;
      readonly normalizedEmail: string;
      readonly displayName: string | null;
      readonly role: 'IT_ADMIN' | 'OPERATOR' | 'TECHNICIAN';
      readonly passwordHash: string;
      readonly auditSequence: 0;
    },
    context: UnitOfWorkContext,
  ): Promise<void> {
    const username = input.username.trim();
    const email = input.email.trim().toLowerCase();
    await this.userModel.create(
      [
        {
          ...input,
          username,
          email,
          normalizedUsername: username.toLowerCase(),
          normalizedEmail: email,
          status: 'ACTIVE',
          additionalPermissions: [],
          presencePreference: 'AUTOMATIC',
          mustChangePassword: true,
          passwordChangedAt: null,
        },
      ],
      { session: context as unknown as ClientSession },
    );
  }

  async allocateAuditSequence(
    userId: string,
    expectedSequence: number,
    context: UnitOfWorkContext,
  ): Promise<number | null> {
    const result = await this.userModel
      .updateOne(
        { userId, auditSequence: expectedSequence },
        { $inc: { auditSequence: 1 } },
        { session: context as unknown as ClientSession },
      )
      .exec();
    return getMatchedCount(result) === 1 ? expectedSequence + 1 : null;
  }

  async updatePasswordWithAuditSequence(
    input: {
      readonly userId: string;
      readonly expectedSequence: number;
      readonly passwordHash: string;
      readonly changedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<number | null> {
    const result = await this.userModel
      .updateOne(
        {
          userId: input.userId,
          status: 'ACTIVE',
          auditSequence: input.expectedSequence,
        },
        {
          $set: {
            passwordHash: input.passwordHash,
            mustChangePassword: false,
            passwordChangedAt: input.changedAt,
          },
          $inc: { auditSequence: 1 },
        },
        { session: context as unknown as ClientSession },
      )
      .exec();
    return getMatchedCount(result) === 1 ? input.expectedSequence + 1 : null;
  }

  async updatePassword(input: {
    readonly userId: string;
    readonly passwordHash: string;
    readonly changedAt: Date;
  }): Promise<boolean> {
    const result = await this.userModel
      .updateOne(
        { userId: input.userId, status: 'ACTIVE' },
        {
          $set: {
            passwordHash: input.passwordHash,
            mustChangePassword: false,
            passwordChangedAt: input.changedAt,
          },
        },
      )
      .exec();
    return getMatchedCount(result) > 0;
  }

  async create(input: {
    readonly sessionId: string;
    readonly userId: string;
    readonly refreshTokenHash: string;
    readonly expiresAt: Date;
  }): Promise<void> {
    await this.sessionModel.create([
      {
        ...input,
        usedRefreshTokenHashes: [],
        revokedAt: null,
        presenceLeaseExpiresAt: null,
      },
    ]);
  }

  async findByRefreshTokenHash(hash: string) {
    const session = await this.sessionModel
      .findOne({
        $or: [{ refreshTokenHash: hash }, { usedRefreshTokenHashes: hash }],
      })
      .select('+refreshTokenHash +usedRefreshTokenHashes')
      .lean()
      .exec();
    if (!session) return null;
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      isCurrentToken: session.refreshTokenHash === hash,
    };
  }

  async rotateRefreshToken(input: {
    readonly sessionId: string;
    readonly currentTokenHash: string;
    readonly nextTokenHash: string;
    readonly now: Date;
  }): Promise<boolean> {
    const session = await this.sessionModel
      .findOneAndUpdate(
        {
          sessionId: input.sessionId,
          refreshTokenHash: input.currentTokenHash,
          revokedAt: null,
          expiresAt: { $gt: input.now },
        },
        {
          $addToSet: { usedRefreshTokenHashes: input.currentTokenHash },
          $set: { refreshTokenHash: input.nextTokenHash },
        },
        { new: true },
      )
      .exec();
    return session !== null;
  }

  async revokeSession(sessionId: string, at: Date): Promise<void> {
    await this.sessionModel
      .updateOne({ sessionId, revokedAt: null }, { $set: { revokedAt: at } })
      .exec();
  }

  async revokeSessionsExcept(
    userId: string,
    currentSessionId: string,
    at: Date,
    context?: UnitOfWorkContext,
  ): Promise<void> {
    const filter = {
      userId,
      sessionId: { $ne: currentSessionId },
      revokedAt: null,
    };
    const update = { $set: { revokedAt: at } };
    const query = context
      ? this.sessionModel.updateMany(filter, update, {
          session: context as unknown as ClientSession,
        })
      : this.sessionModel.updateMany(filter, update);
    await query.exec();
  }

  async revokeByUsedRefreshTokenHash(hash: string, at: Date): Promise<boolean> {
    const result = await this.sessionModel
      .updateOne(
        { usedRefreshTokenHashes: hash, revokedAt: null },
        { $set: { revokedAt: at } },
      )
      .exec();
    return getMatchedCount(result) > 0;
  }
}

function toCredentialRecord(user: HumanAccountDocument) {
  return user;
}

function getMatchedCount(result: { matchedCount: number } | number): number {
  return typeof result === 'number' ? result : result.matchedCount;
}

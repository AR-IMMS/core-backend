import { randomBytes, randomUUID } from 'node:crypto';

import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION,
  type AuditFact,
  type OutboxWriterPort,
  type UnitOfWorkPort,
} from '@platform/events';

import { createIamUser } from '../domain/user';
import type { RoleCode } from '../domain/role-permissions';
import type {
  HumanAuthStorePort,
  HumanSessionStorePort,
} from './ports/human-auth-store.port';
import type { PasswordHasherPort } from './ports/password-hasher.port';

export class AuditSequenceConflictError extends Error {
  constructor() {
    super('IAM audit sequence changed concurrently');
    this.name = 'AuditSequenceConflictError';
  }
}

export class CurrentPasswordMismatchError extends Error {
  constructor() {
    super('Current password is invalid');
    this.name = 'CurrentPasswordMismatchError';
  }
}

export class InitialAdminConfigurationError extends Error {
  constructor() {
    super('Initial IT Admin bootstrap configuration is incomplete');
    this.name = 'InitialAdminConfigurationError';
  }
}

export interface CreateHumanUserInput {
  readonly actorUserId: string;
  readonly username: string;
  readonly email: string;
  readonly role: RoleCode;
  readonly displayName?: string;
}

export interface ProvisionedHumanUser {
  readonly userId: string;
  readonly username: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: RoleCode;
  readonly status: 'ACTIVE';
  readonly additionalPermissions: readonly [];
  readonly effectivePermissions: readonly string[];
  readonly mustChangePassword: true;
  readonly temporaryPassword: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Provisions human identities with hashed credentials and transactional audit. */
export class UserProvisioningService {
  constructor(
    private readonly users: HumanAuthStorePort &
      Pick<HumanSessionStorePort, 'revokeSessionsExcept'>,
    private readonly passwords: PasswordHasherPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly outbox: OutboxWriterPort,
    private readonly now: () => Date = () => new Date(),
    private readonly generateUserId: () => string = () => randomUUID(),
    private readonly generateTemporaryPassword: () => string = () =>
      randomBytes(24).toString('base64url'),
  ) {}

  /** Creates the initial IT Admin from operator-supplied secret material. */
  async bootstrapInitialAdmin(input: {
    readonly userId?: string;
    readonly username?: string;
    readonly email?: string;
    readonly initialPassword?: string;
  }): Promise<'created' | 'already-exists'> {
    try {
      return await this.unitOfWork.run<'created' | 'already-exists'>(
        async (context) => {
          if (await this.users.hasAnyItAdmin(context)) return 'already-exists';

          const username = input.username?.trim();
          const email = input.email?.trim();
          const initialPassword = input.initialPassword;
          if (!username || !email || !initialPassword) {
            throw new InitialAdminConfigurationError();
          }

          const account = normalizeAccount({ username, email });
          const userId = input.userId?.trim() || this.generateUserId();
          const user = createIamUser({
            userId,
            role: 'IT_ADMIN',
            status: 'ACTIVE',
          });
          const passwordHash = await this.passwords.hash(initialPassword);
          await this.users.createInitialAdmin(
            {
              ...account,
              userId,
              passwordHash,
              auditSequence: 0,
            },
            context,
          );
          const sequence = await this.users.allocateAuditSequence(
            userId,
            0,
            context,
          );
          if (sequence === null) throw new AuditSequenceConflictError();

          await this.outbox.append(
            createUserAuditFact({
              actor: { type: 'service', id: 'iam-initial-admin-bootstrap' },
              userId,
              sequence,
              username: account.username,
              email: account.email,
              role: user.role,
              occurredAt: this.now(),
            }),
            context,
          );
          return 'created';
        },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      return this.unitOfWork.run<'already-exists'>(async (context) => {
        if (await this.users.hasAnyItAdmin(context)) return 'already-exists';
        throw error;
      });
    }
  }

  /** Creates an active user and returns a one-time credential to the caller. */
  async createUser(input: CreateHumanUserInput): Promise<ProvisionedHumanUser> {
    const userId = this.generateUserId();
    const account = normalizeAccount(input);
    const access = createIamUser({
      userId,
      role: input.role,
      status: 'ACTIVE',
    });
    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    const createdAt = this.now();

    await this.unitOfWork.run(async (context) => {
      await this.users.createProvisionedUser(
        {
          ...account,
          userId,
          role: input.role,
          passwordHash,
          auditSequence: 0,
        },
        context,
      );
      const sequence = await this.users.allocateAuditSequence(
        userId,
        0,
        context,
      );
      if (sequence === null) throw new AuditSequenceConflictError();

      await this.outbox.append(
        createUserAuditFact({
          actor: { type: 'user', id: input.actorUserId },
          userId,
          sequence,
          username: account.username,
          email: account.email,
          role: input.role,
          displayName: account.displayName,
          occurredAt: createdAt,
        }),
        context,
      );
    });

    return {
      userId,
      username: account.username,
      email: account.email,
      displayName: account.displayName,
      role: input.role,
      status: 'ACTIVE',
      additionalPermissions: [],
      effectivePermissions: access.effectivePermissions,
      mustChangePassword: true,
      temporaryPassword,
      createdAt,
      updatedAt: createdAt,
    };
  }

  /** Changes a credential, requiring old-password proof unless rotation is forced. */
  async changePassword(input: {
    readonly userId: string;
    readonly sessionId: string;
    readonly currentPassword?: string;
    readonly newPassword: string;
  }): Promise<void> {
    await this.unitOfWork.run(async (context) => {
      const user = await this.users.findByUserId(input.userId, context);
      if (!user || user.status !== 'ACTIVE') {
        throw new CurrentPasswordMismatchError();
      }
      if (
        !user.mustChangePassword &&
        (!input.currentPassword ||
          !(await this.passwords.verify(
            user.passwordHash,
            input.currentPassword,
          )))
      ) {
        throw new CurrentPasswordMismatchError();
      }
      const changedAt = this.now();
      const passwordHash = await this.passwords.hash(input.newPassword);
      const sequence = await this.users.updatePasswordWithAuditSequence(
        {
          userId: input.userId,
          expectedSequence: user.auditSequence,
          passwordHash,
          changedAt,
        },
        context,
      );
      if (sequence === null) throw new AuditSequenceConflictError();

      await this.users.revokeSessionsExcept(
        input.userId,
        input.sessionId,
        changedAt,
        context,
      );
      await this.outbox.append(
        {
          event_id: randomUUID(),
          event_type: AUDIT_FACT_EVENT_TYPE,
          event_version: AUDIT_FACT_EVENT_VERSION,
          producer: 'iam',
          occurred_at: changedAt.toISOString(),
          resource: {
            type: 'iam.user',
            id: input.userId,
            sequence,
          },
          payload: {
            actor: { type: 'user', id: input.userId },
            action: 'iam.credential.changed',
            changes: [{ field: 'password_updated', after: true }],
          },
          context: {},
        },
        context,
      );
    });
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

function normalizeAccount(input: {
  readonly username: string;
  readonly email: string;
  readonly displayName?: string;
}) {
  const username = input.username.trim();
  const email = input.email.trim().toLowerCase();
  return {
    username,
    normalizedUsername: username.toLowerCase(),
    email,
    normalizedEmail: email,
    displayName: input.displayName?.trim() || null,
  };
}

function createUserAuditFact(input: {
  readonly actor: { readonly type: string; readonly id: string };
  readonly userId: string;
  readonly sequence: number;
  readonly username: string;
  readonly email: string;
  readonly role: RoleCode;
  readonly displayName?: string | null;
  readonly occurredAt: Date;
}): AuditFact {
  return {
    event_id: randomUUID(),
    event_type: AUDIT_FACT_EVENT_TYPE,
    event_version: AUDIT_FACT_EVENT_VERSION,
    producer: 'iam',
    occurred_at: input.occurredAt.toISOString(),
    resource: {
      type: 'iam.user',
      id: input.userId,
      sequence: input.sequence,
    },
    payload: {
      actor: input.actor,
      action: 'iam.user.created',
      changes: [
        { field: 'username', after: input.username },
        { field: 'email', after: input.email },
        { field: 'role', after: input.role },
        { field: 'status', after: 'ACTIVE' },
        ...(input.displayName === undefined
          ? []
          : [{ field: 'display_name', after: input.displayName }]),
      ],
    },
    context: {},
  };
}

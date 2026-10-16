import { randomBytes, randomUUID } from 'node:crypto';

import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION,
  AUDIT_FACT_EVENT_VERSION_V2,
  type AuditFact,
  type AuditFactV2,
  type AuditValueV2,
  type OutboxWriterPort,
  type UnitOfWorkContext,
  type UnitOfWorkPort,
} from '@platform/events';

import { IAM_PERMISSION_CODES } from '../domain/permission-catalog';
import {
  getRolePermissions,
  IAM_ROLE_CODES,
  resolveEffectivePermissions,
  type PermissionCode,
  type RoleCode,
} from '../domain/role-permissions';
import {
  changeUserRole,
  changeUserStatus,
  createIamUser,
} from '../domain/user';
import type { UserStatus } from '../domain/user';
import type { PasswordHasherPort } from './ports/password-hasher.port';
import type {
  ManagedHumanUser,
  UserAdministrationStorePort,
} from './ports/user-administration-store.port';

const MAX_OCC_ATTEMPTS = 3;

/** A fresh read should be made and the complete mutation retried. */
export class UserMutationConcurrencyError extends Error {
  constructor() {
    super('IAM user changed concurrently');
    this.name = 'UserMutationConcurrencyError';
  }
}

/** Stable conflict returned after bounded whole-transaction retries. */
export class UserAdministrationConflictError extends Error {
  constructor() {
    super('User changed concurrently; retry the request');
    this.name = 'UserAdministrationConflictError';
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super('IAM user was not found');
    this.name = 'UserNotFoundError';
  }
}

export class SelfUserRoleChangeError extends Error {
  constructor() {
    super('Administrators cannot change their own role');
    this.name = 'SelfUserRoleChangeError';
  }
}

export class SelfUserPermissionChangeError extends Error {
  constructor() {
    super('Administrators cannot change their own additional permissions');
    this.name = 'SelfUserPermissionChangeError';
  }
}

export class SelfDisableError extends Error {
  constructor() {
    super('Administrators cannot disable their own account');
    this.name = 'SelfDisableError';
  }
}

export class LastActiveItAdminError extends Error {
  constructor() {
    super('Cannot remove the last active IT Admin');
    this.name = 'LastActiveItAdminError';
  }
}

/** IAM user directory and administration use cases with transactional audit. */
export class UserAdministrationService {
  constructor(
    private readonly users: UserAdministrationStorePort,
    private readonly passwords: PasswordHasherPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly outbox: OutboxWriterPort,
    private readonly now: () => Date = () => new Date(),
    private readonly generateTemporaryPassword: () => string = () =>
      randomBytes(24).toString('base64url'),
  ) {}

  async listUsers(input: {
    readonly pageSize: number;
    readonly afterUserId?: string;
  }) {
    const result = await this.users.listUsers({
      limit: input.pageSize + 1,
      ...(input.afterUserId === undefined
        ? {}
        : { afterUserId: input.afterUserId }),
    });
    const page = result.items.slice(0, input.pageSize);
    const hasMore = result.hasMore || result.items.length > input.pageSize;
    return {
      users: page.map(toPublicUser),
      nextCursorUserId: hasMore ? (page.at(-1)?.userId ?? null) : null,
    };
  }

  async getUser(userId: string) {
    const user = await this.users.findUser(userId);
    return user ? toPublicUser(user) : null;
  }

  async updateProfile(input: {
    readonly actorUserId: string;
    readonly userId: string;
    readonly username?: string;
    readonly email?: string;
    readonly displayName?: string | null;
  }) {
    return this.withOccRetry(async (context) => {
      const current = await this.requireUser(input.userId, context);
      const username = input.username?.trim();
      const email = input.email?.trim().toLowerCase();
      const displayName =
        input.displayName === undefined
          ? undefined
          : input.displayName?.trim() || null;
      const changes: {
        field: string;
        before: string | null;
        after: string | null;
      }[] = [];
      if (username !== undefined && username !== current.username) {
        changes.push({
          field: 'username',
          before: current.username,
          after: username,
        });
      }
      if (email !== undefined && email !== current.email) {
        changes.push({ field: 'email', before: current.email, after: email });
      }
      if (displayName !== undefined && displayName !== current.displayName) {
        changes.push({
          field: 'display_name',
          before: current.displayName,
          after: displayName,
        });
      }
      if (changes.length === 0) return toPublicUser(current);

      const updatedAt = this.now();
      const sequence = await this.users.updateProfile(
        {
          userId: input.userId,
          expectedSequence: current.auditSequence,
          ...(changes.some((change) => change.field === 'username')
            ? { username, normalizedUsername: username?.toLowerCase() }
            : {}),
          ...(changes.some((change) => change.field === 'email')
            ? { email, normalizedEmail: email }
            : {}),
          ...(changes.some((change) => change.field === 'display_name')
            ? { displayName }
            : {}),
          updatedAt,
        },
        context,
      );
      if (sequence === null) throw new UserMutationConcurrencyError();
      await this.outbox.append(
        createAuditFact({
          actorUserId: input.actorUserId,
          userId: input.userId,
          sequence,
          action: 'iam.user.updated',
          changes,
          occurredAt: updatedAt,
        }),
        context,
      );
      return toPublicUser({
        ...current,
        ...(username ? { username } : {}),
        ...(email ? { email } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
        updatedAt,
        auditSequence: sequence,
      });
    });
  }

  async replaceRole(input: {
    readonly actorUserId: string;
    readonly userId: string;
    readonly role: RoleCode;
  }) {
    if (input.actorUserId === input.userId) throw new SelfUserRoleChangeError();
    return this.withOccRetry(async (context) => {
      const current = await this.requireUser(input.userId, context);
      const domainUser = toDomainUser(current);
      const activeAdminCount =
        current.role === 'IT_ADMIN' && current.status === 'ACTIVE'
          ? await this.users.countActiveItAdmins(context)
          : 0;
      if (
        current.role === 'IT_ADMIN' &&
        current.status === 'ACTIVE' &&
        input.role !== 'IT_ADMIN' &&
        activeAdminCount <= 1
      ) {
        throw new LastActiveItAdminError();
      }
      const changed = changeUserRole(domainUser, input.role, activeAdminCount);
      const clearsAdditionalPermissions =
        input.role === current.role && current.additionalPermissions.length > 0;
      if (changed === domainUser && !clearsAdditionalPermissions) {
        return toPublicUser(current);
      }
      if (
        domainUser.role === 'IT_ADMIN' &&
        domainUser.status === 'ACTIVE' &&
        input.role !== 'IT_ADMIN'
      ) {
        if (activeAdminCount <= 1) throw new LastActiveItAdminError();
        if (!(await this.users.guardActiveAdminSet(input.userId, context))) {
          throw new UserMutationConcurrencyError();
        }
      }
      const updatedAt = this.now();
      const sequence = await this.users.replaceRole(
        {
          userId: input.userId,
          expectedSequence: current.auditSequence,
          role: input.role,
          updatedAt,
        },
        context,
      );
      if (sequence === null) throw new UserMutationConcurrencyError();
      await this.outbox.append(
        createAuditFactV2({
          actorUserId: input.actorUserId,
          userId: input.userId,
          sequence,
          action:
            current.role === input.role
              ? 'iam.user.permissions_changed'
              : 'iam.user.role_changed',
          changes: [
            ...(current.role === input.role
              ? []
              : [{ field: 'role', before: current.role, after: input.role }]),
            {
              field: 'additional_permissions',
              before: [...current.additionalPermissions],
              after: [],
            },
          ],
          occurredAt: updatedAt,
        }),
        context,
      );
      return toPublicUser({
        ...current,
        role: input.role,
        additionalPermissions: [],
        updatedAt,
        auditSequence: sequence,
      });
    });
  }

  async replaceAdditionalPermissions(input: {
    readonly actorUserId: string;
    readonly userId: string;
    readonly permissions: readonly PermissionCode[];
  }) {
    if (input.actorUserId === input.userId) {
      throw new SelfUserPermissionChangeError();
    }
    return this.withOccRetry(async (context) => {
      const current = await this.requireUser(input.userId, context);
      const desired = IAM_PERMISSION_CODES.filter((code) =>
        input.permissions.includes(code),
      );
      // Domain resolution rejects unknown, duplicate, baseline, and restricted grants.
      resolveEffectivePermissions(current.role, input.permissions);
      if (samePermissionSet(current.additionalPermissions, desired)) {
        return toPublicUser(current);
      }
      const updatedAt = this.now();
      const sequence = await this.users.replacePermissions(
        {
          userId: input.userId,
          expectedSequence: current.auditSequence,
          additionalPermissions: desired,
          updatedAt,
        },
        context,
      );
      if (sequence === null) throw new UserMutationConcurrencyError();
      await this.outbox.append(
        createAuditFactV2({
          actorUserId: input.actorUserId,
          userId: input.userId,
          sequence,
          action: 'iam.user.permissions_changed',
          changes: [
            {
              field: 'additional_permissions',
              before: [...current.additionalPermissions],
              after: desired,
            },
          ],
          occurredAt: updatedAt,
        }),
        context,
      );
      return toPublicUser({
        ...current,
        additionalPermissions: desired,
        updatedAt,
        auditSequence: sequence,
      });
    });
  }

  async setStatus(input: {
    readonly actorUserId: string;
    readonly userId: string;
    readonly status: UserStatus;
  }) {
    if (input.actorUserId === input.userId && input.status === 'INACTIVE') {
      throw new SelfDisableError();
    }
    return this.withOccRetry(async (context) => {
      const current = await this.requireUser(input.userId, context);
      const domainUser = toDomainUser(current);
      const activeAdminCount =
        current.role === 'IT_ADMIN' && current.status === 'ACTIVE'
          ? await this.users.countActiveItAdmins(context)
          : 0;
      if (
        current.role === 'IT_ADMIN' &&
        current.status === 'ACTIVE' &&
        input.status === 'INACTIVE' &&
        activeAdminCount <= 1
      ) {
        throw new LastActiveItAdminError();
      }
      const changed = changeUserStatus(
        domainUser,
        input.status,
        activeAdminCount,
      );
      if (changed === domainUser) return toPublicUser(current);
      if (
        domainUser.role === 'IT_ADMIN' &&
        domainUser.status === 'ACTIVE' &&
        changed.status === 'INACTIVE'
      ) {
        if (activeAdminCount <= 1) throw new LastActiveItAdminError();
        if (!(await this.users.guardActiveAdminSet(input.userId, context))) {
          throw new UserMutationConcurrencyError();
        }
      }
      const updatedAt = this.now();
      const sequence = await this.users.setStatus(
        {
          userId: input.userId,
          expectedSequence: current.auditSequence,
          status: input.status,
          updatedAt,
        },
        context,
      );
      if (sequence === null) throw new UserMutationConcurrencyError();
      if (input.status === 'INACTIVE') {
        await this.users.revokeSessions(input.userId, updatedAt, context);
      }
      await this.outbox.append(
        createAuditFact({
          actorUserId: input.actorUserId,
          userId: input.userId,
          sequence,
          action: 'iam.user.status_changed',
          changes: [
            { field: 'status', before: current.status, after: input.status },
          ],
          occurredAt: updatedAt,
        }),
        context,
      );
      return toPublicUser({
        ...current,
        status: input.status,
        updatedAt,
        auditSequence: sequence,
      });
    });
  }

  async resetPassword(input: {
    readonly actorUserId: string;
    readonly userId: string;
  }) {
    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    await this.withOccRetry(async (context) => {
      const current = await this.requireUser(input.userId, context);
      const changedAt = this.now();
      const sequence = await this.users.resetCredential(
        {
          userId: input.userId,
          expectedSequence: current.auditSequence,
          passwordHash,
          changedAt,
        },
        context,
      );
      if (sequence === null) throw new UserMutationConcurrencyError();
      await this.users.revokeSessions(input.userId, changedAt, context);
      await this.outbox.append(
        createAuditFact({
          actorUserId: input.actorUserId,
          userId: input.userId,
          sequence,
          action: 'iam.credential.reset',
          changes: [{ field: 'credential_reset', after: true }],
          occurredAt: changedAt,
        }),
        context,
      );
    });
    return { temporaryPassword, mustChangePassword: true as const };
  }

  async revokeSessions(input: {
    readonly actorUserId: string;
    readonly userId: string;
  }) {
    return this.withOccRetry(async (context) => {
      const current = await this.requireUser(input.userId, context);
      const occurredAt = this.now();
      const revokedCount = await this.users.revokeSessions(
        input.userId,
        occurredAt,
        context,
      );
      if (revokedCount === 0) return { revokedCount: 0 };
      const sequence = await this.users.allocateAuditSequence(
        input.userId,
        current.auditSequence,
        occurredAt,
        context,
      );
      if (sequence === null) throw new UserMutationConcurrencyError();
      await this.outbox.append(
        createAuditFact({
          actorUserId: input.actorUserId,
          userId: input.userId,
          sequence,
          action: 'iam.session.revoked',
          changes: [{ field: 'sessions_revoked', after: revokedCount }],
          occurredAt,
        }),
        context,
      );
      return { revokedCount };
    });
  }

  listRoles() {
    const descriptions: Record<RoleCode, string> = {
      IT_ADMIN:
        'Full administrative access subject to IAM and business invariants.',
      OPERATOR: 'Coordinates incidents, tickets, and maintenance planning.',
      TECHNICIAN: 'Reads operational context and performs assigned field work.',
    };
    return IAM_ROLE_CODES.map((code) => ({
      code,
      description: descriptions[code],
      permissions: [...getRolePermissions(code)],
    }));
  }

  listPermissions() {
    const capability: Record<PermissionCode, string> = {
      'user:read': 'View user directory and administrative details',
      'user:manage': 'Create and update users, status, and credentials',
      'user:grant': 'Assign roles and additional permissions',
      'asset:read': 'View asset hierarchy and topology',
      'asset:manage': 'Create, update, and remove assets and mappings',
      'monitoring:read': 'View monitoring status, metrics, and alerts',
      'monitoring:manage': 'Manage monitoring configuration and alert rules',
      'incident:read': 'View incidents, episodes, and evidence',
      'incident:investigate':
        'Record investigation and request AI investigation',
      'incident:manage': 'Manage incident decisions and lifecycle',
      'ticket:read': 'View tickets and processing history',
      'ticket:create': 'Create a ticket',
      'ticket:manage': 'Classify, update, and assign tickets',
      'ticket:close': 'Conclude and close tickets subject to owner policy',
      'maintenance:read': 'View maintenance activities and checklists',
      'maintenance:manage': 'Plan, create, and assign activities',
      'maintenance:execute': 'Perform and record field maintenance',
      'maintenance:verify': 'Verify maintenance results',
      'audit:read': 'Read audit records through protected query APIs',
    };
    return IAM_PERMISSION_CODES.map((code) => ({
      code,
      capability: capability[code],
    }));
  }

  private requireUser(userId: string, context: UnitOfWorkContext) {
    return this.users.findUser(userId, context).then((user) => {
      if (!user) throw new UserNotFoundError();
      return user;
    });
  }

  private async withOccRetry<TResult>(
    operation: (context: UnitOfWorkContext) => Promise<TResult>,
  ): Promise<TResult> {
    for (let attempt = 0; attempt < MAX_OCC_ATTEMPTS; attempt += 1) {
      try {
        return await this.unitOfWork.run(operation);
      } catch (error) {
        if (!isRetryableUserConflict(error)) throw error;
        if (attempt === MAX_OCC_ATTEMPTS - 1) {
          throw new UserAdministrationConflictError();
        }
      }
    }
    throw new UserAdministrationConflictError();
  }
}

function isRetryableUserConflict(error: unknown): boolean {
  if (error instanceof UserMutationConcurrencyError) return true;
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === 112) return true;
  if ('codeName' in error && error.codeName === 'WriteConflict') return true;
  if ('hasErrorLabel' in error && typeof error.hasErrorLabel === 'function') {
    try {
      return (error as { hasErrorLabel(label: string): boolean }).hasErrorLabel(
        'TransientTransactionError',
      );
    } catch {
      return false;
    }
  }
  return false;
}

function toPublicUser(user: ManagedHumanUser) {
  return {
    id: user.userId,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    additionalPermissions: [...user.additionalPermissions],
    effectivePermissions: resolveEffectivePermissions(
      user.role,
      user.additionalPermissions,
    ),
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function toDomainUser(user: ManagedHumanUser) {
  return createIamUser({
    userId: user.userId,
    role: user.role,
    status: user.status,
    additionalPermissions: user.additionalPermissions,
  });
}

function samePermissionSet(
  current: readonly PermissionCode[],
  desired: readonly PermissionCode[],
): boolean {
  return (
    current.length === desired.length &&
    current.every((code) => desired.includes(code))
  );
}

function createAuditFact(input: {
  readonly actorUserId: string;
  readonly userId: string;
  readonly sequence: number;
  readonly action: string;
  readonly changes: readonly {
    readonly field: string;
    readonly before?: string | number | boolean | null;
    readonly after?: string | number | boolean | null;
  }[];
  readonly occurredAt: Date;
}): AuditFact {
  return {
    event_id: randomUUID(),
    event_type: AUDIT_FACT_EVENT_TYPE,
    event_version: AUDIT_FACT_EVENT_VERSION,
    producer: 'iam',
    occurred_at: input.occurredAt.toISOString(),
    resource: { type: 'iam.user', id: input.userId, sequence: input.sequence },
    payload: {
      actor: { type: 'user', id: input.actorUserId },
      action: input.action,
      changes: input.changes,
    },
    context: {},
  };
}

function createAuditFactV2(input: {
  readonly actorUserId: string;
  readonly userId: string;
  readonly sequence: number;
  readonly action: string;
  readonly changes: readonly {
    readonly field: string;
    readonly before?: AuditValueV2;
    readonly after?: AuditValueV2;
  }[];
  readonly occurredAt: Date;
}): AuditFactV2 {
  return {
    event_id: randomUUID(),
    event_type: AUDIT_FACT_EVENT_TYPE,
    event_version: AUDIT_FACT_EVENT_VERSION_V2,
    producer: 'iam',
    occurred_at: input.occurredAt.toISOString(),
    resource: { type: 'iam.user', id: input.userId, sequence: input.sequence },
    payload: {
      actor: { type: 'user', id: input.actorUserId },
      action: input.action,
      changes: input.changes,
    },
    context: {},
  };
}

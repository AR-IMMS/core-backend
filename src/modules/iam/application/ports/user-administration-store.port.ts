import type { UnitOfWorkContext } from '@platform/events';
import type { PermissionCode, RoleCode } from '../../domain/role-permissions';
import type { UserStatus } from '../../domain/user';

/** Safe IAM user projection used by directory and administration operations. */
export interface ManagedHumanUser {
  readonly userId: string;
  readonly username: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: RoleCode;
  readonly status: UserStatus;
  readonly additionalPermissions: readonly PermissionCode[];
  readonly mustChangePassword: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly auditSequence: number;
}

/** IAM-owned persistence boundary for administrative user mutations. */
export interface UserAdministrationStorePort {
  findUser(
    userId: string,
    context?: UnitOfWorkContext,
  ): Promise<ManagedHumanUser | null>;
  listUsers(input: {
    readonly afterUserId?: string;
    readonly limit: number;
  }): Promise<{
    readonly items: readonly ManagedHumanUser[];
    readonly hasMore: boolean;
  }>;
  countActiveItAdmins(context: UnitOfWorkContext): Promise<number>;
  /** Writes a guard field on another active IT Admin to serialize admin removal. */
  guardActiveAdminSet(
    excludingUserId: string,
    context: UnitOfWorkContext,
  ): Promise<boolean>;
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
  ): Promise<number | null>;
  replaceRole(
    input: {
      readonly userId: string;
      readonly expectedSequence: number;
      readonly role: RoleCode;
      readonly updatedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<number | null>;
  replacePermissions(
    input: {
      readonly userId: string;
      readonly expectedSequence: number;
      readonly additionalPermissions: readonly PermissionCode[];
      readonly updatedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<number | null>;
  setStatus(
    input: {
      readonly userId: string;
      readonly expectedSequence: number;
      readonly status: UserStatus;
      readonly updatedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<number | null>;
  resetCredential(
    input: {
      readonly userId: string;
      readonly expectedSequence: number;
      readonly passwordHash: string;
      readonly changedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<number | null>;
  revokeSessions(
    userId: string,
    at: Date,
    context: UnitOfWorkContext,
  ): Promise<number>;
  allocateAuditSequence(
    userId: string,
    expectedSequence: number,
    occurredAt: Date,
    context: UnitOfWorkContext,
  ): Promise<number | null>;
}

/** Nest injection token for the IAM user administration persistence port. */
export const IAM_USER_ADMINISTRATION_STORE = Symbol(
  'IAM_USER_ADMINISTRATION_STORE',
);

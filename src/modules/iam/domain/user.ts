import {
  resolveEffectivePermissions,
  isIamRoleCode,
  type PermissionCode,
  type RoleCode,
} from './role-permissions';
import { isIamPermissionCode } from './permission-catalog';
import type { UserPresencePreference } from './user-presence';

/** Active and inactive states supported by the IAM API contract. */
export type UserStatus = 'ACTIVE' | 'INACTIVE';

/** IAM-owned access state needed to resolve a human user's capabilities. */
export interface IamUser {
  readonly userId: string;
  readonly role: RoleCode;
  readonly status: UserStatus;
  readonly additionalPermissions: readonly PermissionCode[];
  readonly effectivePermissions: readonly PermissionCode[];
  readonly presencePreference: UserPresencePreference;
}

/** Input for creating IAM access state without credentials or persistence details. */
export interface CreateIamUserInput {
  readonly userId: string;
  readonly role: RoleCode;
  readonly status: UserStatus;
  readonly additionalPermissions?: readonly PermissionCode[];
  readonly presencePreference?: UserPresencePreference;
}

/** Creates validated IAM user access state. */
export function createIamUser(input: CreateIamUserInput): IamUser {
  if (!input.userId.trim()) {
    throw new Error('IAM user ID cannot be empty');
  }

  if (!isIamRoleCode(input.role)) {
    throw new Error(`Unsupported IAM role: ${String(input.role)}`);
  }

  if (input.status !== 'ACTIVE' && input.status !== 'INACTIVE') {
    throw new Error(`Unsupported IAM user status: ${String(input.status)}`);
  }

  const additionalPermissions = [...(input.additionalPermissions ?? [])];
  const presencePreference = input.presencePreference ?? 'AUTOMATIC';
  assertPresencePreference(presencePreference);
  const effectivePermissions = resolveEffectivePermissions(
    input.role,
    additionalPermissions,
  );

  return Object.freeze({
    userId: input.userId,
    role: input.role,
    status: input.status,
    additionalPermissions: Object.freeze(additionalPermissions),
    effectivePermissions: Object.freeze([...effectivePermissions]),
    presencePreference,
  });
}

/** Replaces a user's role and atomically clears grants from the previous role. */
export function changeUserRole(
  user: IamUser,
  role: RoleCode,
  activeItAdminCount: number,
): IamUser {
  assertActiveItAdminCount(activeItAdminCount);

  if (!isIamRoleCode(role)) {
    throw new Error(`Unsupported IAM role: ${String(role)}`);
  }

  if (role === user.role) {
    return user;
  }

  assertNotLastActiveItAdmin(user, role !== 'IT_ADMIN', activeItAdminCount);

  return createIamUser({
    userId: user.userId,
    role,
    status: user.status,
    presencePreference: user.presencePreference,
  });
}

/** Changes account status while protecting the last active IT Admin. */
export function changeUserStatus(
  user: IamUser,
  status: UserStatus,
  activeItAdminCount: number,
): IamUser {
  assertActiveItAdminCount(activeItAdminCount);

  if (status !== 'ACTIVE' && status !== 'INACTIVE') {
    throw new Error(`Unsupported IAM user status: ${String(status)}`);
  }

  if (status === user.status) {
    return user;
  }

  assertNotLastActiveItAdmin(user, status === 'INACTIVE', activeItAdminCount);

  return createIamUser({
    userId: user.userId,
    role: user.role,
    status,
    additionalPermissions: user.additionalPermissions,
    presencePreference: user.presencePreference,
  });
}

/** Changes a user's cross-device presence preference independently of status. */
export function changeUserPresencePreference(
  user: IamUser,
  preference: UserPresencePreference,
): IamUser {
  assertPresencePreference(preference);

  if (preference === user.presencePreference) {
    return user;
  }

  return createIamUser({
    userId: user.userId,
    role: user.role,
    status: user.status,
    additionalPermissions: user.additionalPermissions,
    presencePreference: preference,
  });
}

/** Checks whether an active user has every required fixed capability. */
export function hasAllPermissions(
  user: IamUser,
  requiredPermissions: readonly PermissionCode[],
): boolean {
  if (user.status !== 'ACTIVE') {
    return false;
  }

  const effectivePermissionSet = new Set(user.effectivePermissions);
  return requiredPermissions.every(
    (permission) =>
      isKnownPermission(permission) && effectivePermissionSet.has(permission),
  );
}

function isKnownPermission(permission: string): permission is PermissionCode {
  return isIamPermissionCode(permission);
}

function assertActiveItAdminCount(count: number): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('Active IT Admin count must be a non-negative integer');
  }
}

function assertPresencePreference(
  preference: string,
): asserts preference is UserPresencePreference {
  if (
    preference !== 'AUTOMATIC' &&
    preference !== 'BUSY' &&
    preference !== 'AWAY'
  ) {
    throw new Error(`Unsupported user presence preference: ${preference}`);
  }
}

function assertNotLastActiveItAdmin(
  user: IamUser,
  transitionRemovesAdmin: boolean,
  activeItAdminCount: number,
): void {
  if (
    user.role === 'IT_ADMIN' &&
    user.status === 'ACTIVE' &&
    transitionRemovesAdmin &&
    activeItAdminCount <= 1
  ) {
    throw new Error('Cannot remove the last active IT Admin');
  }
}

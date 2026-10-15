import {
  IAM_PERMISSION_CODES,
  isIamPermissionCode,
} from './permission-catalog';

/** System-defined roles for human IAM users. */
export const IAM_ROLE_CODES = ['IT_ADMIN', 'OPERATOR', 'TECHNICIAN'] as const;

/** A role code approved by the IAM domain. */
export type RoleCode = (typeof IAM_ROLE_CODES)[number];

/** A permission code from IAM's fixed catalog. */
export type PermissionCode = (typeof IAM_PERMISSION_CODES)[number];

const roleCodeSet: ReadonlySet<string> = new Set(IAM_ROLE_CODES);

const rolePermissions: Readonly<Record<RoleCode, readonly PermissionCode[]>> = {
  IT_ADMIN: IAM_PERMISSION_CODES,
  OPERATOR: [
    'asset:read',
    'monitoring:read',
    'incident:read',
    'incident:investigate',
    'incident:manage',
    'ticket:read',
    'ticket:create',
    'ticket:manage',
    'ticket:close',
    'maintenance:read',
    'maintenance:manage',
    'maintenance:verify',
  ],
  TECHNICIAN: [
    'asset:read',
    'monitoring:read',
    'ticket:read',
    'maintenance:read',
    'maintenance:execute',
  ],
};

const rolePermissionSets: Readonly<Record<RoleCode, ReadonlySet<string>>> = {
  IT_ADMIN: new Set(rolePermissions.IT_ADMIN),
  OPERATOR: new Set(rolePermissions.OPERATOR),
  TECHNICIAN: new Set(rolePermissions.TECHNICIAN),
};

/** Checks a role code against IAM's fixed human role catalog. */
export function isIamRoleCode(role: string): role is RoleCode {
  return roleCodeSet.has(role);
}

/** Returns a role's immutable baseline permission list. */
export function getRolePermissions(role: RoleCode): readonly PermissionCode[] {
  if (!isIamRoleCode(role)) {
    throw new Error(`Unsupported IAM role: ${String(role)}`);
  }

  return rolePermissions[role];
}

/** Resolves a role baseline plus validated, additive user permission grants. */
export function resolveEffectivePermissions(
  role: RoleCode,
  additionalPermissions: readonly PermissionCode[] = [],
): readonly PermissionCode[] {
  const baseline = getRolePermissions(role);
  const baselineSet = rolePermissionSets[role];
  const additionalSet = new Set<string>();

  for (const permission of additionalPermissions) {
    if (!isIamPermissionCode(permission)) {
      throw new Error(`Unknown IAM permission: ${String(permission)}`);
    }

    if (additionalSet.has(permission)) {
      throw new Error(`Duplicate additional IAM permission: ${permission}`);
    }

    if (baselineSet.has(permission)) {
      throw new Error(
        `Additional IAM permission duplicates role baseline: ${permission}`,
      );
    }

    if (
      role !== 'IT_ADMIN' &&
      (permission === 'user:manage' || permission === 'user:grant')
    ) {
      throw new Error(
        `Non-admin roles cannot receive additional IAM permission: ${permission}`,
      );
    }

    additionalSet.add(permission);
  }

  return [...baseline, ...additionalPermissions];
}

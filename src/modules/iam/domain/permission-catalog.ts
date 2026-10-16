/** Fixed permission codes owned by IAM and shared through its public catalog contract. */
export const IAM_PERMISSION_CODES = [
  'user:read',
  'user:manage',
  'user:grant',
  'asset:read',
  'asset:manage',
  'monitoring:read',
  'monitoring:manage',
  'incident:read',
  'incident:investigate',
  'incident:manage',
  'ticket:read',
  'ticket:create',
  'ticket:manage',
  'ticket:close',
  'maintenance:read',
  'maintenance:manage',
  'maintenance:execute',
  'maintenance:verify',
  'audit:read',
] as const;

const permissionCodeSet: ReadonlySet<string> = new Set(IAM_PERMISSION_CODES);

/** Checks a permission code against IAM's authoritative fixed catalog. */
export function isIamPermissionCode(code: string): boolean {
  return permissionCodeSet.has(code);
}

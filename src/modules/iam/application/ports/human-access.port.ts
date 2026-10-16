import type { PermissionCode, RoleCode } from '../../domain/role-permissions';
import type { UserStatus } from '../../domain/user';

/** Stable principal shape exposed by IAM to consuming application modules. */
export interface HumanPrincipal {
  readonly userId: string;
  readonly role: RoleCode;
  readonly status: UserStatus;
}

/** Public application boundary for resolving a human principal and its capabilities. */
export interface HumanAccessPort {
  getPrincipal(userId: string): Promise<HumanPrincipal | null>;
  hasAllPermissions(
    userId: string,
    required: readonly PermissionCode[],
  ): Promise<boolean>;
}

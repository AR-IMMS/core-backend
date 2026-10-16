import type {
  HumanAccessPort,
  HumanPrincipal,
} from './ports/human-access.port';
import type { HumanAccessStorePort } from './ports/human-access-store.port';
import { isIamPermissionCode } from '../domain/permission-catalog';
import type { PermissionCode } from '../domain/role-permissions';

/** Implements IAM's public current-principal and coarse capability contract. */
export class HumanAccessService implements HumanAccessPort {
  constructor(private readonly store: HumanAccessStorePort) {}

  async getPrincipal(userId: string): Promise<HumanPrincipal | null> {
    const access = await this.store.findByUserId(userId);
    if (!access) return null;

    return {
      userId: access.userId,
      role: access.role,
      status: access.status,
    };
  }

  async hasAllPermissions(
    userId: string,
    required: readonly PermissionCode[],
  ): Promise<boolean> {
    if (required.length === 0 || !required.every(isIamPermissionCode)) {
      return false;
    }

    const access = await this.store.findByUserId(userId);
    if (!access || access.status !== 'ACTIVE') return false;

    const effective = new Set(access.effectivePermissions);
    return required.every((permission) => effective.has(permission));
  }
}

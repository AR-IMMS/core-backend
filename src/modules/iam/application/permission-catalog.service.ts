import type { PermissionCatalogPort } from './ports/permission-catalog.port';
import { isIamPermissionCode } from '../domain/permission-catalog';

/** Application-facing query service over IAM's authoritative permission catalog. */
export class PermissionCatalogService implements PermissionCatalogPort {
  isKnownPermissionCode(code: string): boolean {
    return isIamPermissionCode(code);
  }
}

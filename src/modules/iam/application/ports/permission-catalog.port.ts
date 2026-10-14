/** Public read contract for validating a permission code against IAM's catalog. */
export interface PermissionCatalogPort {
  isKnownPermissionCode(code: string): boolean;
}

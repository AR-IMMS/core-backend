import { PermissionCatalogService } from './application/permission-catalog.service';

describe('PermissionCatalogService', () => {
  /** It recognizes permission codes from IAM's fixed catalog. */
  test('accepts catalog codes and rejects unknown values', () => {
    const catalog = new PermissionCatalogService();

    expect(catalog.isKnownPermissionCode('user:read')).toBe(true);
    expect(catalog.isKnownPermissionCode('audit:read')).toBe(true);
    expect(catalog.isKnownPermissionCode('user:unknown')).toBe(false);
  });
});

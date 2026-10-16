import {
  PermissionCode,
  resolveEffectivePermissions,
  RoleCode,
} from './role-permissions';

describe('IAM role permissions', () => {
  /** It gives IT Admin every explicitly catalogued permission. */
  test('resolves IT_ADMIN to the full fixed permission catalog', () => {
    expect(resolveEffectivePermissions('IT_ADMIN')).toEqual([
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
    ]);
  });

  /** It keeps the Operator baseline aligned with the approved role matrix. */
  test('resolves OPERATOR to its fixed baseline and additive grants', () => {
    expect(
      resolveEffectivePermissions('OPERATOR', ['maintenance:execute']),
    ).toEqual([
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
      'maintenance:execute',
    ]);
  });

  /** It keeps Technician capabilities limited to its approved field-work baseline. */
  test('resolves TECHNICIAN to its fixed baseline', () => {
    expect(resolveEffectivePermissions('TECHNICIAN')).toEqual([
      'asset:read',
      'monitoring:read',
      'ticket:read',
      'maintenance:read',
      'maintenance:execute',
    ]);
  });

  /** It rejects values outside the fixed permission catalog, including wildcards. */
  test.each(['custom:permission', '*'])(
    'rejects unknown permission %s',
    (permission) => {
      expect(() =>
        resolveEffectivePermissions('OPERATOR', [permission as PermissionCode]),
      ).toThrow();
    },
  );

  /** It rejects duplicate and role-baseline duplicate additional grants. */
  test.each([
    [
      'duplicate additional grant',
      ['maintenance:execute', 'maintenance:execute'],
    ],
    ['baseline duplicate grant', ['ticket:read']],
  ])('rejects a %s', (_reason, permissions) => {
    expect(() =>
      resolveEffectivePermissions('OPERATOR', permissions as PermissionCode[]),
    ).toThrow();
  });

  /** It prevents non-admin users from receiving IAM privilege-management grants. */
  test.each(['user:manage', 'user:grant'] as const)(
    'rejects additional %s for non-admin roles',
    (permission) => {
      expect(() =>
        resolveEffectivePermissions('OPERATOR', [permission]),
      ).toThrow();
    },
  );

  /** It limits role codes to the three system-defined human roles. */
  test('rejects an unsupported role code', () => {
    expect(() => resolveEffectivePermissions('AGENT' as RoleCode)).toThrow();
  });
});

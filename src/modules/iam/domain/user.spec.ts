import {
  changeUserPresencePreference,
  changeUserRole,
  changeUserStatus,
  createIamUser,
  hasAllPermissions,
} from './user';

describe('IAM user access', () => {
  /** It clears old additive grants when an administrator changes the user's role. */
  test('clears additional permissions when role changes', () => {
    const user = createIamUser({
      userId: 'user-1',
      role: 'OPERATOR',
      status: 'ACTIVE',
      additionalPermissions: ['maintenance:execute'],
    });

    const changed = changeUserRole(user, 'TECHNICIAN', 2);

    expect(changed.role).toBe('TECHNICIAN');
    expect(changed.additionalPermissions).toEqual([]);
    expect(changed.effectivePermissions).toEqual([
      'asset:read',
      'monitoring:read',
      'ticket:read',
      'maintenance:read',
      'maintenance:execute',
    ]);
  });

  /** It rejects demoting the only active IT Admin. */
  test('rejects demoting the last active IT Admin', () => {
    const user = createIamUser({
      userId: 'admin-1',
      role: 'IT_ADMIN',
      status: 'ACTIVE',
    });

    expect(() => changeUserRole(user, 'OPERATOR', 1)).toThrow();
  });

  /** It permits demotion when another active IT Admin remains. */
  test('allows demotion when another active IT Admin remains', () => {
    const user = createIamUser({
      userId: 'admin-1',
      role: 'IT_ADMIN',
      status: 'ACTIVE',
    });

    expect(changeUserRole(user, 'OPERATOR', 2).role).toBe('OPERATOR');
  });

  /** It rejects making the only active IT Admin inactive. */
  test('rejects deactivating the last active IT Admin', () => {
    const user = createIamUser({
      userId: 'admin-1',
      role: 'IT_ADMIN',
      status: 'ACTIVE',
    });

    expect(() => changeUserStatus(user, 'INACTIVE', 1)).toThrow();
  });

  /** It does not authorize inactive users even when their permissions match. */
  test('denies all permissions to an inactive user', () => {
    const user = createIamUser({
      userId: 'operator-1',
      role: 'OPERATOR',
      status: 'INACTIVE',
    });

    expect(hasAllPermissions(user, ['ticket:read'])).toBe(false);
  });

  /** It requires every requested capability for an active user. */
  test('uses all-of semantics for active-user permission checks', () => {
    const user = createIamUser({
      userId: 'operator-1',
      role: 'OPERATOR',
      status: 'ACTIVE',
    });

    expect(
      hasAllPermissions(user, ['ticket:read', 'incident:investigate']),
    ).toBe(true);
    expect(hasAllPermissions(user, ['ticket:read', 'user:manage'])).toBe(false);
  });

  /** It rejects invalid status values when building IAM user access state. */
  test('rejects status values outside ACTIVE and INACTIVE', () => {
    expect(() =>
      createIamUser({
        userId: 'user-1',
        role: 'OPERATOR',
        status: 'DISABLED' as never,
      }),
    ).toThrow();
  });

  /** It defaults new users to automatic availability across all devices. */
  test('defaults presence preference to automatic', () => {
    const user = createIamUser({
      userId: 'user-1',
      role: 'OPERATOR',
      status: 'ACTIVE',
    });

    expect(user.presencePreference).toBe('AUTOMATIC');
  });

  /** It changes the user-level presence preference without changing account status. */
  test('changes presence preference independently from account status', () => {
    const user = createIamUser({
      userId: 'user-1',
      role: 'OPERATOR',
      status: 'ACTIVE',
    });

    const updated = changeUserPresencePreference(user, 'BUSY');

    expect(updated.presencePreference).toBe('BUSY');
    expect(updated.status).toBe('ACTIVE');
  });
});

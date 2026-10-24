import { HumanAccessService } from './human-access.service';
import type { HumanAccessStorePort } from './ports/human-access-store.port';

describe('HumanAccessService', () => {
  /** Returns the narrow current principal without exposing IAM user state. */
  it('projects the current access record to the public principal', async () => {
    const service = new HumanAccessService({
      findByUserId: () =>
        Promise.resolve({
          userId: 'user-1',
          role: 'OPERATOR',
          status: 'ACTIVE',
          effectivePermissions: ['ticket:read'],
        }),
    } as unknown as HumanAccessStorePort);

    await expect(service.getPrincipal('user-1')).resolves.toEqual({
      userId: 'user-1',
      role: 'OPERATOR',
      status: 'ACTIVE',
    });
  });

  /** Denies capability checks for missing or inactive accounts. */
  it('denies access when the account is missing or inactive', async () => {
    const store: HumanAccessStorePort = {
      findByUserId: (userId: string) =>
        Promise.resolve(
          userId === 'inactive'
            ? {
                userId,
                role: 'IT_ADMIN',
                status: 'INACTIVE',
                effectivePermissions: ['audit:read'],
                additionalPermissions: [],
                presencePreference: 'AUTOMATIC',
              }
            : null,
        ),
    } as unknown as HumanAccessStorePort;
    const service = new HumanAccessService(store);

    await expect(
      service.hasAllPermissions('missing', ['audit:read']),
    ).resolves.toBe(false);
    await expect(
      service.hasAllPermissions('inactive', ['audit:read']),
    ).resolves.toBe(false);
  });

  /** Requires a non-empty set of known permissions and enforces all-of. */
  it('requires all known permissions and rejects empty or unknown requirements', async () => {
    const service = new HumanAccessService({
      findByUserId: () =>
        Promise.resolve({
          userId: 'user-1',
          role: 'OPERATOR',
          status: 'ACTIVE',
          effectivePermissions: ['ticket:read'],
        }),
    } as unknown as HumanAccessStorePort);

    await expect(
      service.hasAllPermissions('user-1', ['ticket:read']),
    ).resolves.toBe(true);
    await expect(
      service.hasAllPermissions('user-1', ['ticket:read', 'audit:read']),
    ).resolves.toBe(false);
    await expect(service.hasAllPermissions('user-1', [])).resolves.toBe(false);
    await expect(
      service.hasAllPermissions('user-1', ['agent:manage' as never]),
    ).resolves.toBe(false);
  });
});

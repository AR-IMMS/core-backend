import type {
  HumanAuthStorePort,
  HumanSessionStorePort,
} from './ports/human-auth-store.port';
import type { PasswordHasherPort } from './ports/password-hasher.port';
import type { AccessTokenIssuerPort } from './ports/access-token-issuer.port';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  /** It creates one server-side session and never stores the raw refresh token. */
  test('logs in an active user and returns a hashed-refresh session token set', async () => {
    const user = {
      userId: 'u-1',
      username: 'operator',
      email: 'operator@example.test',
      normalizedUsername: 'operator',
      normalizedEmail: 'operator@example.test',
      role: 'OPERATOR' as const,
      status: 'ACTIVE' as const,
      additionalPermissions: [],
      passwordHash: 'encoded-hash',
      mustChangePassword: false,
    };
    const authStore: HumanAuthStorePort = {
      findByIdentifier: jest.fn().mockResolvedValue(user),
      findByUserId: jest.fn().mockResolvedValue(user),
      hasAnyItAdmin: jest.fn(),
      createInitialAdmin: jest.fn(),
      createProvisionedUser: jest.fn(),
      updatePasswordWithAuditSequence: jest.fn(),
      allocateAuditSequence: jest.fn(),
      updatePassword: jest.fn(),
    };
    const sessions: HumanSessionStorePort = {
      create: jest.fn(),
      findByRefreshTokenHash: jest.fn(),
      rotateRefreshToken: jest.fn(),
      revokeSession: jest.fn(),
      revokeSessionsExcept: jest.fn(),
      revokeByUsedRefreshTokenHash: jest.fn(),
    };
    const hasher: PasswordHasherPort = {
      hash: jest.fn(),
      verify: jest.fn().mockResolvedValue(true),
    };
    const tokens: AccessTokenIssuerPort = {
      issueAccessToken: jest.fn().mockResolvedValue('signed-access-token'),
    };
    const now = new Date('2026-10-15T12:00:00Z');
    const service = new AuthService(
      authStore,
      sessions,
      hasher,
      tokens,
      900,
      604_800,
      () => now,
      () => Buffer.from('01234567890123456789012345678901'),
      () => 'session-1',
    );

    const result = await service.login({
      identifier: ' OPERATOR ',
      password: 'pw',
    });

    expect(result).toMatchObject({
      accessToken: 'signed-access-token',
      tokenType: 'Bearer',
      expiresIn: 900,
      refreshExpiresAt: new Date('2026-10-22T12:00:00Z'),
      mustChangePassword: false,
    });
    expect(result.refreshToken).toBeTruthy();
    const created = jest.mocked(sessions.create).mock.calls[0]?.[0];
    expect(created).toMatchObject({
      sessionId: 'session-1',
      userId: 'u-1',
      expiresAt: new Date('2026-10-22T12:00:00Z'),
    });
    expect(created?.refreshTokenHash).not.toBe(result.refreshToken);
    expect(jest.mocked(tokens.issueAccessToken)).toHaveBeenCalledWith(
      'u-1',
      'session-1',
    );
  });

  /** It returns the same credential failure for unknown accounts and bad passwords. */
  test('rejects invalid credentials with a generic error', async () => {
    const authStore = makeAuthStore(null);
    const sessions = makeSessionStore();
    const hasher = makeHasher(false);
    const service = new AuthService(
      authStore,
      sessions,
      hasher,
      makeTokenIssuer(),
      900,
      604_800,
    );

    await expect(
      service.login({ identifier: 'unknown', password: 'wrong' }),
    ).rejects.toThrow('Invalid credentials');
  });
});

function makeAuthStore(user: unknown): HumanAuthStorePort {
  return {
    findByIdentifier: jest.fn().mockResolvedValue(user),
    findByUserId: jest.fn().mockResolvedValue(user),
    hasAnyItAdmin: jest.fn(),
    createInitialAdmin: jest.fn(),
    createProvisionedUser: jest.fn(),
    updatePasswordWithAuditSequence: jest.fn(),
    allocateAuditSequence: jest.fn(),
    updatePassword: jest.fn(),
  };
}

function makeSessionStore(): HumanSessionStorePort {
  return {
    create: jest.fn(),
    findByRefreshTokenHash: jest.fn(),
    rotateRefreshToken: jest.fn(),
    revokeSession: jest.fn(),
    revokeSessionsExcept: jest.fn(),
    revokeByUsedRefreshTokenHash: jest.fn(),
  };
}

function makeHasher(verified: boolean): PasswordHasherPort {
  return { hash: jest.fn(), verify: jest.fn().mockResolvedValue(verified) };
}

function makeTokenIssuer(): AccessTokenIssuerPort {
  return { issueAccessToken: jest.fn().mockResolvedValue('access-token') };
}

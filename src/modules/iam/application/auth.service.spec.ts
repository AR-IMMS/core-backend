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

  /** It hides disabled-account state behind the same generic failure and creates no session. */
  test('rejects inactive accounts with generic invalid credentials', async () => {
    const inactiveUser = {
      ...makeAuthUser(),
      status: 'INACTIVE' as const,
    };
    const authStore = makeAuthStore(inactiveUser);
    const sessions = makeSessionStore();
    const hash = jest.fn();
    const passwords: PasswordHasherPort = {
      hash,
      verify: jest.fn().mockResolvedValue(false),
    };
    const service = new AuthService(
      authStore,
      sessions,
      passwords,
      makeTokenIssuer(),
      900,
      604_800,
    );

    await expect(
      service.login({ identifier: 'operator', password: 'wrong' }),
    ).rejects.toThrow('Invalid credentials');
    expect(sessions.create).not.toHaveBeenCalled();
    expect(hash).toHaveBeenCalledWith('wrong');
  });

  /** It permits only one refresh rotation and revokes the session when the losing request replays the token. */
  test('allows one concurrent refresh winner and revokes the token family on replay', async () => {
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
    const sessions = makeSessionStore();
    jest.mocked(sessions.findByRefreshTokenHash).mockResolvedValue({
      sessionId: 'session-1',
      userId: 'u-1',
      expiresAt: new Date('2026-10-22T12:00:00Z'),
      revokedAt: null,
      isCurrentToken: true,
    });
    let rotations = 0;
    jest
      .mocked(sessions.rotateRefreshToken)
      .mockImplementation(() => Promise.resolve(++rotations === 1));
    const service = new AuthService(
      makeAuthStore(user),
      sessions,
      makeHasher(true),
      makeTokenIssuer(),
      900,
      604_800,
      () => new Date('2026-10-15T12:00:00Z'),
      () => Buffer.from('01234567890123456789012345678901'),
      () => 'session-next',
    );

    const results = await Promise.allSettled([
      service.refresh('opaque-refresh-token-value'),
      service.refresh('opaque-refresh-token-value'),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(sessions.revokeByUsedRefreshTokenHash).toHaveBeenCalledTimes(1);
  });

  /** It enforces login-attempt limits using the normalized account and source key without disclosing the account. */
  test('rejects login attempts when the configured rate limit is exhausted', async () => {
    const limiter = {
      consume: jest
        .fn()
        .mockResolvedValue({ allowed: false, retryAfterSeconds: 17 }),
    };
    const service = new AuthService(
      makeAuthStore(null),
      makeSessionStore(),
      makeHasher(false),
      makeTokenIssuer(),
      900,
      604_800,
      undefined,
      undefined,
      undefined,
      limiter,
      5,
      30,
      60,
    );

    await expect(
      service.checkLoginRateLimit(' ADMIN ', '127.0.0.1'),
    ).rejects.toMatchObject({
      name: 'AuthRateLimitExceededError',
      retryAfterSeconds: 17,
    });
    expect(limiter.consume).toHaveBeenCalledWith(
      'login:127.0.0.1:admin',
      5,
      60,
    );
  });

  /** It keys refresh-attempt limits by the stable session ID so rotation does not reset the budget. */
  test('applies the configured refresh limit to the session', async () => {
    const sessions = makeSessionStore();
    jest.mocked(sessions.findByRefreshTokenHash).mockResolvedValue({
      sessionId: 'session-1',
      userId: 'u-1',
      expiresAt: new Date('2026-10-22T12:00:00Z'),
      revokedAt: null,
      isCurrentToken: true,
    });
    jest.mocked(sessions.rotateRefreshToken).mockResolvedValue(true);
    const limiter = {
      consume: jest
        .fn()
        .mockResolvedValue({ allowed: true, retryAfterSeconds: 60 }),
    };
    const service = new AuthService(
      makeAuthStore(makeAuthUser()),
      sessions,
      makeHasher(true),
      makeTokenIssuer(),
      900,
      604_800,
      () => new Date('2026-10-15T12:00:00Z'),
      () => Buffer.from('01234567890123456789012345678901'),
      () => 'session-1',
      limiter,
      5,
      30,
      60,
    );

    await service.refresh('opaque-refresh-token-value');

    expect(limiter.consume).toHaveBeenCalledWith('refresh:session-1', 30, 60);
  });

  /** It rejects expired refresh sessions before attempting rotation. */
  test('rejects refresh tokens belonging to expired sessions', async () => {
    const sessions = makeSessionStore();
    jest.mocked(sessions.findByRefreshTokenHash).mockResolvedValue({
      sessionId: 'expired-session',
      userId: 'u-1',
      expiresAt: new Date('2026-10-14T12:00:00Z'),
      revokedAt: null,
      isCurrentToken: true,
    });
    const service = new AuthService(
      makeAuthStore(null),
      sessions,
      makeHasher(false),
      makeTokenIssuer(),
      900,
      604_800,
      () => new Date('2026-10-15T12:00:00Z'),
    );

    await expect(service.refresh('expired-refresh-token')).rejects.toThrow(
      'Invalid credentials',
    );
    expect(sessions.rotateRefreshToken).not.toHaveBeenCalled();
  });

  /** It revokes the current server-side session when logout is requested. */
  test('revokes a session on logout', async () => {
    const sessions = makeSessionStore();
    const now = new Date('2026-10-15T12:00:00Z');
    const service = new AuthService(
      makeAuthStore(null),
      sessions,
      makeHasher(false),
      makeTokenIssuer(),
      900,
      604_800,
      () => now,
    );

    await service.logout('session-1');

    expect(sessions.revokeSession).toHaveBeenCalledWith('session-1', now);
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

function makeAuthUser() {
  return {
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

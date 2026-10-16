import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { AccessTokenIssuerPort } from './ports/access-token-issuer.port';
import type {
  HumanAuthStorePort,
  HumanSessionStorePort,
} from './ports/human-auth-store.port';
import type { PasswordHasherPort } from './ports/password-hasher.port';
import type { AuthRateLimiterPort } from './ports/auth-rate-limiter.port';

/** Generic login failure that does not disclose account existence or status. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

/** A rotated refresh credential was presented again; callers keep the public error generic. */
export class RefreshTokenReplayError extends InvalidCredentialsError {
  constructor() {
    super();
    this.name = 'RefreshTokenReplayError';
  }
}

/** A public authentication endpoint has exceeded its configured attempt limit. */
export class AuthRateLimitExceededError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Authentication rate limit exceeded');
    this.name = 'AuthRateLimitExceededError';
  }
}

/** Browser/native-safe token response; refresh plaintext exists only here. */
export interface AuthTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
  readonly refreshExpiresAt: Date;
  readonly mustChangePassword: boolean;
}

/** Implements password verification and opaque rotating server-side sessions. */
export class AuthService {
  constructor(
    private readonly users: HumanAuthStorePort,
    private readonly sessions: HumanSessionStorePort,
    private readonly passwords: PasswordHasherPort,
    private readonly accessTokens: AccessTokenIssuerPort,
    private readonly accessTokenTtlSeconds: number,
    private readonly refreshSessionTtlSeconds: number,
    private readonly now: () => Date = () => new Date(),
    private readonly generateRefreshSecret: () => Buffer = () =>
      randomBytes(32),
    private readonly generateSessionId: () => string = () => randomUUID(),
    private readonly rateLimiter?: AuthRateLimiterPort,
    private readonly loginLimit = 5,
    private readonly refreshLimit = 30,
    private readonly rateWindowSeconds = 60,
  ) {}

  async checkLoginRateLimit(
    identifier: string,
    sourceKey: string,
  ): Promise<void> {
    await this.assertRateLimit(
      `login:${sourceKey}:${identifier.trim().toLowerCase()}`,
      this.loginLimit,
    );
  }

  async login(input: {
    readonly identifier: string;
    readonly password: string;
  }): Promise<AuthTokenSet> {
    const identifier = input.identifier.trim().toLowerCase();
    const user = await this.users.findByIdentifier(identifier);
    if (!user || user.status !== 'ACTIVE') {
      await this.passwords.hash(input.password);
      throw new InvalidCredentialsError();
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      throw new InvalidCredentialsError();
    }

    const now = this.now();
    const sessionId = this.generateSessionId();
    const refreshToken = this.generateRefreshSecret().toString('base64url');
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const refreshExpiresAt = new Date(
      now.getTime() + this.refreshSessionTtlSeconds * 1000,
    );
    await this.sessions.create({
      sessionId,
      userId: user.userId,
      refreshTokenHash,
      expiresAt: refreshExpiresAt,
    });

    return this.createTokenSet(
      user.userId,
      sessionId,
      refreshToken,
      refreshExpiresAt,
      user.mustChangePassword,
    );
  }

  async refresh(
    refreshToken: string,
    sourceKey = 'unknown',
  ): Promise<AuthTokenSet> {
    const currentTokenHash = hashRefreshToken(refreshToken);
    const session =
      await this.sessions.findByRefreshTokenHash(currentTokenHash);
    await this.assertRateLimit(
      session
        ? `refresh:${session.sessionId}`
        : `refresh:${sourceKey}:${currentTokenHash}`,
      this.refreshLimit,
    );
    const now = this.now();
    if (!session || session.revokedAt || session.expiresAt <= now) {
      if (session?.isCurrentToken === false) {
        await this.sessions.revokeSession(session.sessionId, now);
        throw new RefreshTokenReplayError();
      }
      throw new InvalidCredentialsError();
    }

    const nextRefreshToken = this.generateRefreshSecret().toString('base64url');
    const rotated = await this.sessions.rotateRefreshToken({
      sessionId: session.sessionId,
      currentTokenHash,
      nextTokenHash: hashRefreshToken(nextRefreshToken),
      now,
    });
    if (!rotated) {
      await this.sessions.revokeByUsedRefreshTokenHash(currentTokenHash, now);
      throw new RefreshTokenReplayError();
    }

    const user = await this.users.findByUserId(session.userId);
    if (!user || user.status !== 'ACTIVE') {
      await this.sessions.revokeSession(session.sessionId, now);
      throw new InvalidCredentialsError();
    }
    return this.createTokenSet(
      session.userId,
      session.sessionId,
      nextRefreshToken,
      session.expiresAt,
      user.mustChangePassword,
    );
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revokeSession(sessionId, this.now());
  }

  async logoutByRefreshToken(refreshToken: string): Promise<void> {
    const session = await this.sessions.findByRefreshTokenHash(
      hashRefreshToken(refreshToken),
    );
    if (session && !session.revokedAt) {
      await this.sessions.revokeSession(session.sessionId, this.now());
    }
  }

  private async assertRateLimit(key: string, limit: number): Promise<void> {
    if (!this.rateLimiter) return;
    const result = await this.rateLimiter.consume(
      key,
      limit,
      this.rateWindowSeconds,
    );
    if (!result.allowed) {
      throw new AuthRateLimitExceededError(result.retryAfterSeconds);
    }
  }

  private async createTokenSet(
    userId: string,
    sessionId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
    mustChangePassword: boolean,
  ): Promise<AuthTokenSet> {
    return {
      accessToken: await this.accessTokens.issueAccessToken(userId, sessionId),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTokenTtlSeconds,
      refreshExpiresAt,
      mustChangePassword,
    };
  }
}

/** Stores no raw refresh token; a one-way digest is sufficient for lookup. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { AccessTokenIssuerPort } from './ports/access-token-issuer.port';
import type {
  HumanAuthStorePort,
  HumanSessionStorePort,
} from './ports/human-auth-store.port';
import type { PasswordHasherPort } from './ports/password-hasher.port';

/** Generic login failure that does not disclose account existence or status. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
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
  ) {}

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

  async refresh(refreshToken: string): Promise<AuthTokenSet> {
    const currentTokenHash = hashRefreshToken(refreshToken);
    const session =
      await this.sessions.findByRefreshTokenHash(currentTokenHash);
    const now = this.now();
    if (!session || session.revokedAt || session.expiresAt <= now) {
      if (session?.isCurrentToken === false) {
        await this.sessions.revokeSession(session.sessionId, now);
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
      throw new InvalidCredentialsError();
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

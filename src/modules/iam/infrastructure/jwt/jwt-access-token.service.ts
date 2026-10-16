import type { JwtService } from '@nestjs/jwt';

import { randomUUID } from 'node:crypto';

import type { AccessTokenVerifierPort } from '../../application/ports/human-session-access.port';
import type { AccessTokenIssuerPort } from '../../application/ports/access-token-issuer.port';

/** Verifies IAM access tokens and returns identity claims only. */
export class JwtAccessTokenService
  implements AccessTokenVerifierPort, AccessTokenIssuerPort
{
  constructor(
    private readonly jwtService: JwtService,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  issueAccessToken(userId: string, sessionId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sid: sessionId },
      { subject: userId, jwtid: randomUUID() },
    );
  }

  async verifyAccessToken(token: string) {
    if (!token.trim()) return null;

    try {
      const claims = await this.jwtService.verifyAsync<Record<string, unknown>>(
        token,
        {
          algorithms: ['RS256'],
          issuer: this.issuer,
          audience: this.audience,
        },
      );
      if (
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string' ||
        !claims.sub ||
        !claims.sid
      ) {
        return null;
      }
      return { userId: claims.sub, sessionId: claims.sid };
    } catch {
      return null;
    }
  }
}

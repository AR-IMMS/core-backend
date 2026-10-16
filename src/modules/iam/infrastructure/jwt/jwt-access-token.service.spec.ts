import type { JwtService } from '@nestjs/jwt';

import { JwtAccessTokenService } from './jwt-access-token.service';

describe('JwtAccessTokenService', () => {
  /** It signs access claims with the configured module policy and session subject. */
  test('issues an access token bound to a user and session', async () => {
    const signAsync = jest
      .fn<
        Promise<string>,
        [
          payload: Record<string, unknown>,
          options: { subject: string; jwtid: string },
        ]
      >()
      .mockResolvedValue('signed-token');
    const service = new JwtAccessTokenService(
      { signAsync } as unknown as JwtService,
      'issuer',
      'audience',
    );

    await expect(service.issueAccessToken('u-1', 's-1')).resolves.toBe(
      'signed-token',
    );
    expect(signAsync.mock.calls[0]?.[0]).toEqual({ sid: 's-1' });
    expect(signAsync.mock.calls[0]?.[1].subject).toBe('u-1');
    expect(typeof signAsync.mock.calls[0]?.[1].jwtid).toBe('string');
  });

  /** It accepts only verified RS256 tokens with user and session identity claims. */
  test('verifies issuer, audience, and algorithm before returning identity claims', async () => {
    const verifyAsync = jest.fn().mockResolvedValue({ sub: 'u-1', sid: 's-1' });
    const jwt = { verifyAsync } as unknown as JwtService;
    const service = new JwtAccessTokenService(jwt, 'issuer', 'audience');

    await expect(service.verifyAccessToken('signed-token')).resolves.toEqual({
      userId: 'u-1',
      sessionId: 's-1',
    });
    expect(verifyAsync).toHaveBeenCalledWith('signed-token', {
      algorithms: ['RS256'],
      issuer: 'issuer',
      audience: 'audience',
    });
  });

  /** It rejects tokens without both subject and server-side session identity. */
  test.each([[{ sub: 'u-1' }], [{ sid: 's-1' }], [null]])(
    'rejects malformed claims %j',
    async (claims) => {
      const jwt = {
        verifyAsync: jest.fn().mockResolvedValue(claims),
      } as unknown as JwtService;
      const service = new JwtAccessTokenService(jwt, 'issuer', 'audience');

      await expect(
        service.verifyAccessToken('signed-token'),
      ).resolves.toBeNull();
    },
  );

  /** It maps all signature, expiry, issuer, or audience failures to invalid tokens. */
  test('returns null when JWT verification fails', async () => {
    const jwt = {
      verifyAsync: jest.fn().mockRejectedValue(new Error('signature invalid')),
    } as unknown as JwtService;
    const service = new JwtAccessTokenService(jwt, 'issuer', 'audience');

    await expect(service.verifyAccessToken('bad-token')).resolves.toBeNull();
  });
});

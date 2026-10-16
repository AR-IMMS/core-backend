import { InMemoryAuthRateLimiter } from './in-memory-auth-rate-limiter';

describe('InMemoryAuthRateLimiter', () => {
  /** It allows only the configured number of attempts during one fixed window. */
  test('limits attempts and resets the counter after expiry', async () => {
    let now = 1_000;
    const limiter = new InMemoryAuthRateLimiter(() => now);

    await expect(limiter.consume('login:key', 2, 60)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(limiter.consume('login:key', 2, 60)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(limiter.consume('login:key', 2, 60)).resolves.toMatchObject({
      allowed: false,
    });
    now += 60_000;
    await expect(limiter.consume('login:key', 2, 60)).resolves.toMatchObject({
      allowed: true,
    });
  });
});

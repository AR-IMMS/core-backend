import { envSchema } from './env.schema';

describe('validated IAM runtime configuration', () => {
  /** It supplies the agreed presence lease defaults without requiring IAM activation. */
  test('defaults presence heartbeat to 30 seconds and lease to 90 seconds', () => {
    const config = envSchema.parse({});

    expect(config.IAM_PRESENCE_HEARTBEAT_INTERVAL_SECONDS).toBe(30);
    expect(config.IAM_PRESENCE_LEASE_TTL_SECONDS).toBe(90);
    expect(config.IAM_ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(config.IAM_REFRESH_SESSION_TTL_SECONDS).toBe(604_800);
    expect(config.IAM_LOGIN_RATE_LIMIT_PER_MINUTE).toBe(5);
    expect(config.IAM_REFRESH_RATE_LIMIT_PER_MINUTE).toBe(30);
  });

  /** It rejects lease settings that can expire before the next heartbeat. */
  test('requires presence lease lifetime to exceed heartbeat interval', () => {
    const result = envSchema.safeParse({
      IAM_PRESENCE_HEARTBEAT_INTERVAL_SECONDS: 30,
      IAM_PRESENCE_LEASE_TTL_SECONDS: 30,
    });

    expect(result.success).toBe(false);
  });

  /** It requires signing and verification keys to be configured as a pair. */
  test('rejects an incomplete JWT key pair', () => {
    const result = envSchema.safeParse({
      IAM_JWT_PRIVATE_KEY: 'private-key',
    });

    expect(result.success).toBe(false);
  });

  /** It requires an explicit compatibility decision before enabling cross-site cookie behavior. */
  test('rejects SameSite=None until browser compatibility is validated', () => {
    expect(
      envSchema.safeParse({ IAM_BROWSER_COOKIE_SAME_SITE: 'none' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        IAM_BROWSER_COOKIE_SAME_SITE: 'none',
        IAM_BROWSER_CROSS_SITE_COMPATIBILITY_VALIDATED: 'true',
      }).success,
    ).toBe(true);
  });

  /** It requires exact origins and a dedicated CSRF secret whenever browser CORS is enabled. */
  test('validates browser authentication origins and CSRF secret', () => {
    expect(
      envSchema.safeParse({
        IAM_BROWSER_ALLOWED_ORIGINS: 'https://dashboard.example.test/path',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        IAM_BROWSER_ALLOWED_ORIGINS: 'https://dashboard.example.test',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        IAM_BROWSER_ALLOWED_ORIGINS: 'https://dashboard.example.test',
        IAM_BROWSER_CSRF_SECRET: 'a-dedicated-secret-at-least-32-characters',
      }).success,
    ).toBe(true);
  });
});

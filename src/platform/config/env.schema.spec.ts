import { envSchema } from './env.schema';

describe('validated IAM runtime configuration', () => {
  /** It supplies the agreed presence lease defaults without requiring IAM activation. */
  test('defaults presence heartbeat to 30 seconds and lease to 90 seconds', () => {
    const config = envSchema.parse({});

    expect(config.IAM_PRESENCE_HEARTBEAT_INTERVAL_SECONDS).toBe(30);
    expect(config.IAM_PRESENCE_LEASE_TTL_SECONDS).toBe(90);
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
});

import { envSchema } from '@platform/config/env.schema';
import { parseZammadReadConfig } from './zammad-read.config';

const valid = {
  baseUrl: 'https://zammad.example.test/',
  apiToken: 'fake-test-token',
  expectedGroupId: '42',
};

describe('Zammad configuration (unit)', () => {
  it('normalizes an explicit origin and group with a bounded default timeout', () => {
    expect(parseZammadReadConfig(valid)).toEqual({
      ...valid,
      baseUrl: 'https://zammad.example.test',
      expectedGroupId: 42,
      timeoutMs: 5000,
    });
  });

  it('retains optional settings through platform environment validation', () => {
    const baseEnvironment = {
      AGENT_CONTROL_PLANE_BASE_URL: 'https://control.example.test',
      AGENT_ENROLLMENT_RECOVERY_KEY: Buffer.alloc(32).toString('base64'),
    };
    expect(envSchema.parse(baseEnvironment).ZAMMAD_BASE_URL).toBeUndefined();
    expect(
      envSchema.parse({
        ...baseEnvironment,
        ZAMMAD_BASE_URL: valid.baseUrl,
        ZAMMAD_API_TOKEN: valid.apiToken,
        ZAMMAD_EXPECTED_GROUP_ID: '42',
        ZAMMAD_READ_TIMEOUT_MS: '2500',
      }),
    ).toMatchObject({
      ZAMMAD_BASE_URL: valid.baseUrl,
      ZAMMAD_API_TOKEN: valid.apiToken,
      ZAMMAD_EXPECTED_GROUP_ID: '42',
      ZAMMAD_READ_TIMEOUT_MS: '2500',
    });
  });

  it.each([
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'http://[::1]:8081',
  ])('allows explicit loopback development origin %s', (baseUrl) => {
    expect(parseZammadReadConfig({ ...valid, baseUrl }).baseUrl).toBe(baseUrl);
  });

  it.each([
    { baseUrl: 'http://remote.example.test' },
    { baseUrl: 'https://user:password@example.test' },
    { baseUrl: 'https://example.test/api/v1' },
    { baseUrl: 'https://example.test?token=secret' },
    { baseUrl: 'https://example.test#fragment' },
    { baseUrl: 'not-a-url' },
    { apiToken: '' },
    { apiToken: 'secret\r\nInjected: header' },
    { apiToken: undefined },
    { expectedGroupId: undefined },
    { expectedGroupId: 0 },
    { expectedGroupId: 1.5 },
    { expectedGroupId: Number.MAX_SAFE_INTEGER + 1 },
    { timeoutMs: 0 },
    { timeoutMs: 60_001 },
  ])(
    'rejects unsafe or incomplete configuration %# without input details',
    (patch) => {
      expect(() => parseZammadReadConfig({ ...valid, ...patch })).toThrow(
        new Error('Invalid Zammad read configuration'),
      );
    },
  );
});

describe('explicit private-network HTTP configuration', () => {
  const input = {
    baseUrl: 'http://zammad-nginx:8080',
    apiToken: 'fake-token',
    expectedGroupId: 42,
  };
  it('rejects an unapproved non-loopback plaintext origin', () => {
    expect(() => parseZammadReadConfig(input)).toThrow(
      'Invalid Zammad read configuration',
    );
  });
  it('accepts only the explicitly declared private origin', () => {
    expect(
      parseZammadReadConfig({
        ...input,
        privateHttpOrigin: 'http://zammad-nginx:8080',
      }).baseUrl,
    ).toBe(input.baseUrl);
  });
  it('rejects a different private origin', () => {
    expect(() =>
      parseZammadReadConfig({
        ...input,
        privateHttpOrigin: 'http://other:8080',
      }),
    ).toThrow('Invalid Zammad read configuration');
  });
});

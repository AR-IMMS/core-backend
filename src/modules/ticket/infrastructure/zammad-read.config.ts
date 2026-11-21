import z from 'zod';

const configSchema = z
  .object({
    baseUrl: z
      .string()
      .url()
      .refine((value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return (
          ['https:', 'http:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname === '/'
        );
      }),
    privateHttpOrigin: z.string().url().optional(),
    apiToken: z
      .string()
      .min(1)
      .regex(/^[A-Za-z0-9._~-]+$/),
    expectedGroupId: z.coerce
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER),
    timeoutMs: z.coerce.number().int().min(1).max(60_000).default(5_000),
  })
  .refine((config) => {
    if (!URL.canParse(config.baseUrl)) return false;
    const url = new URL(config.baseUrl);
    return (
      url.protocol === 'https:' ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      config.privateHttpOrigin === url.origin
    );
  });

export type ZammadReadConfig = Readonly<z.infer<typeof configSchema>>;

/** Validate at the adapter boundary; never include Zod input/issues in errors. */
export function parseZammadReadConfig(input: unknown): ZammadReadConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    throw new Error('Invalid Zammad read configuration');
  }
  return Object.freeze({
    ...result.data,
    baseUrl: new URL(result.data.baseUrl).origin,
  });
}

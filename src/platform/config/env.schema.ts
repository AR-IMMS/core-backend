import z from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'staging', 'production'])
      .default('development'),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    APP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),

    IAM_PRESENCE_HEARTBEAT_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(30),

    IAM_PRESENCE_LEASE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(90),

    IAM_JWT_PRIVATE_KEY: z.string().trim().min(1).optional(),
    IAM_JWT_PUBLIC_KEY: z.string().trim().min(1).optional(),
    IAM_JWT_ISSUER: z.string().trim().min(1).default('core-backend'),
    IAM_JWT_AUDIENCE: z.string().trim().min(1).default('ar-imms-clients'),
    IAM_ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
    IAM_REFRESH_SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(604_800),

    IAM_BOOTSTRAP_USER_ID: z.string().trim().min(1).optional(),
    IAM_BOOTSTRAP_USERNAME: z.string().trim().min(1).optional(),
    IAM_BOOTSTRAP_EMAIL: z.string().trim().email().optional(),
    IAM_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),

    MONGODB_URI: z
      .string()
      .trim()
      .min(1, 'MONGODB_URI must not be empty')
      .refine(
        (value) => /^mongodb(?:\+srv)?:\/\//.test(value),
        'MONGODB_URI must use mongodb:// or mongodb+srv://',
      )
      .optional(),

    MONGODB_DB_NAME: z.string().trim().min(1).default('ar_imms_core'),

    POSTGRES_URI: z
      .string()
      .trim()
      .min(1, 'POSTGRES_URI must not be empty')
      .refine(
        (value) => /^postgres(?:ql)?:\/\//.test(value),
        'POSTGRES_URI must use postgres:// or postgresql://',
      )
      .optional(),

    POSTGRES_POOL_MAX_SIZE: z.coerce.number().int().positive().default(10),

    POSTGRES_POOL_MIN_SIZE: z.coerce.number().int().nonnegative().default(0),

    POSTGRES_CONNECT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5_000),

    // OpenTelemetry configurations
    OTEL_SERVICE_NAME: z.string().trim().min(1).default('core-backend'),

    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.preprocess(
      (value: unknown) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.string().trim().url().optional(),
    ),
  })
  .superRefine((env, context) => {
    if (Boolean(env.IAM_JWT_PRIVATE_KEY) !== Boolean(env.IAM_JWT_PUBLIC_KEY)) {
      context.addIssue({
        code: 'custom',
        path: ['IAM_JWT_PRIVATE_KEY'],
        message:
          'IAM_JWT_PRIVATE_KEY and IAM_JWT_PUBLIC_KEY must be configured together',
      });
    }
    if (
      env.IAM_PRESENCE_LEASE_TTL_SECONDS <=
      env.IAM_PRESENCE_HEARTBEAT_INTERVAL_SECONDS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['IAM_PRESENCE_LEASE_TTL_SECONDS'],
        message:
          'IAM_PRESENCE_LEASE_TTL_SECONDS must exceed IAM_PRESENCE_HEARTBEAT_INTERVAL_SECONDS',
      });
    }
    if (env.POSTGRES_POOL_MIN_SIZE > env.POSTGRES_POOL_MAX_SIZE) {
      context.addIssue({
        code: 'custom',
        path: ['POSTGRES_POOL_MIN_SIZE'],
        message:
          'POSTGRES_POOL_MIN_SIZE must not exceed POSTGRES_POOL_MAX_SIZE',
      });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

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

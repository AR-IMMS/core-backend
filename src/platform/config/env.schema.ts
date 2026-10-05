import z from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  APP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  MONGODB_URI: z
    .string()
    .trim()
    .min(1, 'MONGODB_URI is required')
    .refine(
      (value) => /^mongodb(?:\+srv)?:\/\//.test(value),
      'MONGODB_URI must use mongodb:// or mongodb+srv://',
    ),

  MONGODB_DB_NAME: z.string().trim().min(1).default('ar_imms_core'),
});

export type EnvConfig = z.infer<typeof envSchema>;

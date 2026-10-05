import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { envSchema } from './env.schema';

type RuntimeEnvironment = 'development' | 'test' | 'production';

function resolveRuntimeEnvironment(
  value: string | undefined,
): RuntimeEnvironment {
  if (value === 'test' || value === 'production') {
    return value;
  }

  return 'development';
}

const runtimeEnvironment = resolveRuntimeEnvironment(process.env.NODE_ENV);

const envFilePath = [
  `.env.${runtimeEnvironment}.local`,
  '.env.local',
  `.env.${runtimeEnvironment}`,
  '.env',
];

/**
 * Loads environment files and exposes only validated configuration values.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath,
      skipProcessEnv: true,
      validate: (rawConfig: Record<string, unknown>) => {
        const result = envSchema.safeParse(rawConfig);

        if (!result.success) {
          const details = result.error.issues
            .map((issue) => {
              const key = issue.path.map(String).join('.') || 'environment';
              return `- ${key}: ${issue.message}`;
            })
            .join('\n');

          throw new Error(`Invalid environment configuration:\n${details}`);
        }

        return result.data;
      },
    }),
  ],
})
export class PlatformConfigModule {}

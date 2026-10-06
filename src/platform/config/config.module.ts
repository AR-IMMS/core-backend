import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { createDatabaseConfig } from './database.config';
import { envSchema } from './env.schema';

type RuntimeEnvironment = 'development' | 'test' | 'staging' | 'production';

function resolveRuntimeEnvironment(
  value: string | undefined,
): RuntimeEnvironment {
  if (value === 'test' || value === 'staging' || value === 'production') {
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
        const environment = envSchema.parse(rawConfig);

        return {
          ...environment,
          database: createDatabaseConfig(environment),
        };
      },
    }),
  ],
})
export class PlatformConfigModule {}

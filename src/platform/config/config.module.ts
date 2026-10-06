import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { createDatabaseConfig } from './database.config';
import { envSchema } from './env.schema';
import { createLoggingConfig } from './logging.config';
import { resolveEnvFilePaths } from './env-files';

/**
 * Loads environment files and exposes only validated configuration values.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveEnvFilePaths(),
      skipProcessEnv: true,
      validate: (rawConfig: Record<string, unknown>) => {
        const environment = envSchema.parse(rawConfig);

        return {
          ...environment,
          database: createDatabaseConfig(environment),
          logging: createLoggingConfig(environment),
        };
      },
    }),
  ],
})
export class PlatformConfigModule {}

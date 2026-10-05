import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { envSchema } from './env.schema';

const nodeEnv = process.env.NODE_ENV ?? 'development';

const envFilePath = [
  `.env.${nodeEnv}.local`,
  '.env.local',
  `.env.${nodeEnv}`,
  '.env',
];

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: envFilePath,
      validate: (rawConfig) => {
        const result = envSchema.safeParse(rawConfig);

        if (!result.success) {
          const details = result.error.issues
            .map((issue) => {
              const key = issue.path.join('.') || 'environment';
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

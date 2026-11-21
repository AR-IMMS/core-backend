import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformConfigModule } from '@platform/config';
import { EXTERNAL_USER_ACCESS_PORT } from './application/external-user-access.port';
import { ZammadUserAccessAdapter } from './infrastructure/zammad-user-access.adapter';
import { parseZammadReadConfig } from './infrastructure/zammad-read.config';
/** Opt-in internal adapter composition; no public API or host registration. */
@Module({
  imports: [PlatformConfigModule],
  providers: [
    {
      provide: EXTERNAL_USER_ACCESS_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        let excluded: unknown;
        try {
          excluded = JSON.parse(
            config.get<string>('ZAMMAD_NON_HUMAN_USER_IDS') ?? '',
          );
        } catch {
          throw new Error('Invalid external user access configuration');
        }
        if (
          !Array.isArray(excluded) ||
          !excluded.every((id: unknown) => typeof id === 'number')
        )
          throw new Error('Invalid external user access configuration');
        return new ZammadUserAccessAdapter(
          parseZammadReadConfig({
            baseUrl: config.get<unknown>('ZAMMAD_BASE_URL'),
            privateHttpOrigin: config.get<unknown>(
              'ZAMMAD_PRIVATE_HTTP_ORIGIN',
            ),
            apiToken: config.get<unknown>('ZAMMAD_API_TOKEN'),
            expectedGroupId: config.get<unknown>('ZAMMAD_EXPECTED_GROUP_ID'),
            timeoutMs: config.get<unknown>('ZAMMAD_READ_TIMEOUT_MS'),
          }),
          {
            serviceUserId: Number(config.get<string>('ZAMMAD_SERVICE_USER_ID')),
            excludedHumanUserIds: excluded,
          },
        );
      },
    },
  ],
  exports: [EXTERNAL_USER_ACCESS_PORT],
})
export class ZammadUserAccessModule {}

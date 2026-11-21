import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ZammadUserAccessModule } from '../src/modules/ticket/zammad-user-access.module';
import {
  EXTERNAL_USER_ACCESS_PORT,
  type ExternalUserAccessPort,
} from '../src/modules/ticket/application/external-user-access.port';

/** Explicit read-only probe of the approved disposable fixtures; never discovered as a Jest test. */
async function verify() {
  const expectedOrigin = process.env.ZAMMAD_READ_TEST_EXPECTED_BASE_URL;
  assert(expectedOrigin);
  const app = await NestFactory.createApplicationContext(
    ZammadUserAccessModule,
    { logger: false, abortOnError: false },
  );
  try {
    const config = app.get(ConfigService);
    assert.equal(config.getOrThrow<string>('ZAMMAD_BASE_URL'), expectedOrigin);
    assert.equal(
      Number(config.getOrThrow<string>('ZAMMAD_SERVICE_USER_ID')),
      6,
    );
    const port = app.get<ExternalUserAccessPort>(EXTERNAL_USER_ACCESS_PORT);
    for (const id of [4, 5]) {
      assert.deepEqual(await port.getEligibleHuman(id), {
        externalUserId: id,
        groupId: Number(config.getOrThrow<string>('ZAMMAD_EXPECTED_GROUP_ID')),
      });
      console.log(
        JSON.stringify({
          result: 'PASS',
          probe: 'eligible human via REST adapter',
          externalUserId: id,
        }),
      );
    }
    for (const id of [1, 6, 7]) {
      assert.equal(await port.getEligibleHuman(id), null);
      console.log(
        JSON.stringify({
          result: 'PASS',
          probe: 'excluded non-human fixture',
          externalUserId: id,
        }),
      );
    }
  } finally {
    await app.close();
  }
}
void verify().catch(() => {
  console.error(
    'FAIL real user-access verification (configuration, dependency or assertion)',
  );
  process.exitCode = 1;
});

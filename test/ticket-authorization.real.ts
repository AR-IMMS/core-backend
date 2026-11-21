import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { CoreModule } from '../src/app/core.module';
import {
  IAM_HUMAN_ACCESS_PORT,
  type HumanAccessPort,
} from '../src/modules/iam';
import { GetAuthorizedTicket } from '../src/modules/ticket/application/get-authorized-ticket';
import { IdentityMappingSchema } from '../src/modules/ticket/infrastructure/mongodb/identity-mapping.schema';
import { MongoIdentityMappingStore } from '../src/modules/ticket/infrastructure/mongodb/mongo-identity-mapping.store';
import type { IdentityMapping } from '../src/modules/ticket/domain/identity-mapping';
import { ZammadUserAccessAdapter } from '../src/modules/ticket/infrastructure/zammad-user-access.adapter';
import { ZammadTicketReadAdapter } from '../src/modules/ticket/infrastructure/zammad-ticket-read.adapter';
import { parseZammadReadConfig } from '../src/modules/ticket/infrastructure/zammad-read.config';

/** Explicit internal smoke test. The trusted runner selects approved fixture actors;
 * this does not test HTTP authentication and exposes no route. All operations are reads.
 */
async function verify() {
  const app = await NestFactory.createApplicationContext(CoreModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const config = app.get(ConfigService);
    const baseUrl = config.getOrThrow<string>('ZAMMAD_BASE_URL');
    assert.equal(baseUrl, process.env.ZAMMAD_READ_TEST_EXPECTED_BASE_URL);
    const scope = {
      instanceKey: config.getOrThrow<string>('ZAMMAD_INSTANCE_KEY'),
      approvedGroupId: Number(
        config.getOrThrow<string>('ZAMMAD_EXPECTED_GROUP_ID'),
      ),
    };
    assert.equal(scope.instanceKey, 'arimms-p0-generation-1');
    assert.equal(scope.approvedGroupId, 2);
    const connection = app.get<Connection>(getConnectionToken());
    const mappings = new MongoIdentityMappingStore(
      connection.model<IdentityMapping>(
        'TicketAuthorizationSmoke',
        IdentityMappingSchema,
      ),
      scope,
    );
    const readConfig = parseZammadReadConfig({
      baseUrl,
      privateHttpOrigin: config.get<string>('ZAMMAD_PRIVATE_HTTP_ORIGIN'),
      apiToken: config.getOrThrow<string>('ZAMMAD_API_TOKEN'),
      expectedGroupId: scope.approvedGroupId,
    });
    const external = new ZammadUserAccessAdapter(readConfig, {
      serviceUserId: 6,
      excludedHumanUserIds: [1, 6, 7],
    });
    const query = new GetAuthorizedTicket(
      app.get<HumanAccessPort>(IAM_HUMAN_ACCESS_PORT),
      mappings,
      external,
      new ZammadTicketReadAdapter(readConfig),
      scope,
    );
    const operator = '403678c5-a90b-4a06-9a7d-318f27a3c639',
      technician = '53cd2a15-5221-4f49-a822-3c56e4cca637',
      admin = '9c52d3fe-1bf7-4255-8654-6ec9c315070e';
    for (const [actor, id, expected] of [
      [operator, 10, 'allowed'],
      [technician, 10, 'allowed'],
      [technician, 3, 'denied'],
      [operator, 3, 'allowed'],
      [admin, 10, 'denied'],
    ] as const) {
      const result = await query.execute(actor, id);
      assert.equal(result.status, expected);
      console.log(
        JSON.stringify({
          check: 'real-internal-authorization',
          actor,
          ticketId: id,
          status: result.status,
          result: 'PASS',
        }),
      );
    }
    assert.equal(await mappings.findActiveMapping(admin), null);
    console.log('PASS administrator has no Ticket human mapping');
  } finally {
    await app.close();
  }
}
void verify().catch(() => {
  console.error('FAIL real internal authorization (redacted)');
  process.exitCode = 1;
});

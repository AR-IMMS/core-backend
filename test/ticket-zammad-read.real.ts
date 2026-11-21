import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { TicketModule } from '../src/modules/ticket/ticket.module';
import {
  TICKET_READ_PORT,
  TicketReadError,
  type TicketReadPort,
} from '../src/modules/ticket/application/ticket-read.port';

/** Explicit opt-in read verification. Not discovered by either Jest config. */
async function verifyRead(): Promise<void> {
  const id = Number(process.env.ZAMMAD_READ_TEST_TICKET_ID);
  const expectedOrigin = process.env.ZAMMAD_READ_TEST_EXPECTED_BASE_URL;
  assert(Number.isSafeInteger(id) && id > 0 && expectedOrigin);
  const app = await NestFactory.createApplicationContext(TicketModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const config = app.get(ConfigService);
    assert.equal(
      new URL(config.getOrThrow<string>('ZAMMAD_BASE_URL')).origin,
      expectedOrigin,
    );
    const port = app.get<TicketReadPort>(TICKET_READ_PORT);
    const ticket = await port.getTicket(id);
    assert(ticket);
    assert.equal(ticket.externalTicketId, id);
    assert.equal(
      ticket.groupId,
      Number(config.getOrThrow<string>('ZAMMAD_EXPECTED_GROUP_ID')),
    );
    console.log(
      JSON.stringify({
        result: 'PASS',
        verification: 'real Zammad GET through Nest provider',
        nodeVersion: process.version,
        externalTicketId: ticket.externalTicketId,
        number: ticket.number,
        groupId: ticket.groupId,
        nativeOwnerId: ticket.nativeOwnerId,
        customerId: ticket.customerId,
        stateId: ticket.stateId,
        priorityId: ticket.priorityId,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      }),
    );
  } finally {
    await app.close();
  }
}

void verifyRead().catch((error: unknown) => {
  // Neither bootstrap errors nor upstream exceptions are safe to print raw.
  console.error(
    'FAIL real Zammad read verification',
    error instanceof TicketReadError
      ? error.code
      : 'CONFIGURATION_OR_ASSERTION',
  );
  process.exitCode = 1;
});

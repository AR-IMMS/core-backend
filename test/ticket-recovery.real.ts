import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { CoreModule } from '../src/app/core.module';
import { GetAuthorizedTicket } from '../src/modules/ticket/application/get-authorized-ticket';
import { TicketJournal } from '../src/modules/ticket/application/ticket-journal';
import { TicketWorkflow } from '../src/modules/ticket/application/ticket-workflow';
import {
  TICKET_READ_PORT,
  type TicketReadPort,
} from '../src/modules/ticket/application/ticket-read.port';
import type { TicketUpstreamPort } from '../src/modules/ticket/application/ticket-upstream.port';
import { MongoTicketJournalStore } from '../src/modules/ticket/infrastructure/mongodb/mongo-ticket-journal.store';
import { ZammadTicketWorkflowAdapter } from '../src/modules/ticket/infrastructure/zammad-ticket-workflow.adapter';
import { parseZammadReadConfig } from '../src/modules/ticket/infrastructure/zammad-read.config';
import {
  IAM_HUMAN_ACCESS_PORT,
  type HumanAccessPort,
} from '../src/modules/iam';
import {
  ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
  type AssetTopologyAssetQueries,
} from '../src/modules/asset-topology';
import {
  OUTBOX_WRITER_PORT,
  UNIT_OF_WORK_PORT,
  type OutboxWriterPort,
  type UnitOfWorkPort,
} from '../src/platform/events';

const operator = '403678c5-a90b-4a06-9a7d-318f27a3c639';
const technician = '53cd2a15-5221-4f49-a822-3c56e4cca637';
const scope = { instanceKey: 'arimms-p0-generation-1', approvedGroupId: 2 };
let step = 'PoC preflight';

async function verifiedHttpCaller() {
  const token = readFileSync(0, 'utf8').trim();
  assert(/^[A-Za-z0-9_.-]+$/.test(token));
  const request = async (
    method: string,
    path: string,
    status: number,
    body?: object,
    key?: string,
  ): Promise<unknown> => {
    const response = await fetch('http://127.0.0.1:8082/api/v1' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body && key
          ? { 'Content-Type': 'application/json', 'Idempotency-Key': key }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, status);
    return response.json();
  };
  const { data } = z
    .object({
      data: z.object({
        user_id: z.string(),
        role: z.string(),
        status: z.string(),
      }),
    })
    .parse(await request('GET', '/auth/me', 200));
  assert.deepEqual(
    [data.user_id, data.role, data.status],
    [operator, 'OPERATOR', 'ACTIVE'],
  );
  console.log('PASS active Operator verified through public IAM');
  return request;
}

const ticketReceipt = z.object({
  data: z.object({ ticket_id: z.number().int().positive() }),
});
const articleReceipt = z.object({
  data: z.object({ article_id: z.number().int().positive() }),
});

function blockedUntilReleased() {
  let markEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    async wait() {
      markEntered();
      await waiting;
    },
  };
}

async function run() {
  assert.equal(process.env.FLOW04_DISPOSABLE_RECOVERY, 'true');
  assert.equal(process.env.ZAMMAD_BASE_URL, 'http://zammad-nginx:8080');
  assert.equal(
    process.env.ZAMMAD_EXPECTED_GROUP_ID,
    String(scope.approvedGroupId),
  );
  assert.equal(process.env.ZAMMAD_TICKET_CUSTOMER_ID, '7');
  assert.equal(process.env.ZAMMAD_INSTANCE_KEY, scope.instanceKey);
  assert.equal(process.env.ZAMMAD_SERVICE_USER_ID, '6');
  const http =
    process.env.FLOW04_AUTHENTICATED_RECOVERY === 'true'
      ? await verifiedHttpCaller()
      : undefined;
  const app = await NestFactory.createApplicationContext(CoreModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const adapter = new ZammadTicketWorkflowAdapter(
      parseZammadReadConfig({
        baseUrl: process.env.ZAMMAD_BASE_URL,
        privateHttpOrigin: process.env.ZAMMAD_PRIVATE_HTTP_ORIGIN,
        apiToken: process.env.ZAMMAD_API_TOKEN,
        expectedGroupId: scope.approvedGroupId,
      }),
      7,
    );
    const query = app.get(GetAuthorizedTicket);
    const read = app.get<TicketReadPort>(TICKET_READ_PORT);
    const store = app.get(MongoTicketJournalStore);
    const work = (
      port: TicketUpstreamPort,
      outbox = app.get<OutboxWriterPort>(OUTBOX_WRITER_PORT),
    ) =>
      new TicketWorkflow(
        query,
        app.get<HumanAccessPort>(IAM_HUMAN_ACCESS_PORT),
        port,
        read,
        new TicketJournal(
          store,
          app.get<UnitOfWorkPort>(UNIT_OF_WORK_PORT),
          outbox,
        ),
        store,
        app.get<AssetTopologyAssetQueries>(ASSET_TOPOLOGY_ASSET_QUERIES_PORT),
        scope,
        6,
      );
    const command = () => ({ actor: operator, key: randomUUID() });
    const real = work(adapter);

    step = 'accepted create with its result hidden';
    let acceptedId: number | undefined;
    let createCalls = 0;
    let hideNotes = true;
    let loseArticleResponse = true;
    let articleCalls = 0;
    const injected: TicketUpstreamPort = {
      async create(input) {
        createCalls++;
        acceptedId = await adapter.create(input);
        throw new Error('Injected loss after actual Zammad create');
      },
      async articles(id) {
        return hideNotes ? [] : adapter.articles(id);
      },
      async append(id, body, marker) {
        articleCalls++;
        const result = await adapter.append(id, body, marker);
        if (loseArticleResponse)
          throw new Error('Injected loss after actual Zammad append');
        return result;
      },
      update: (id, changes) => adapter.update(id, changes),
      search: (input) => adapter.search(input),
      states: () => adapter.states(),
      priorityAvailable: (id) => adapter.priorityAvailable(id),
    };
    const create = command();
    const fields = {
      title: 'Disposable WF04 recovery ' + randomUUID(),
      description: 'Bounded PoC recovery test',
      priority_id: 2,
      business_owner_user_id: operator,
      assignee_user_id: technician,
    };
    await assert.rejects(work(injected).create(create, fields), {
      code: 'UNRESOLVED',
    });
    const fixture = acceptedId;
    assert(fixture !== undefined && fixture > 12);
    console.log(
      JSON.stringify({
        fixture,
        check: 'upstream accepted create, response hidden from Core',
      }),
    );
    assert.equal(
      await store.links(scope.instanceKey, scope.approvedGroupId, fixture),
      null,
    );
    await assert.rejects(work(injected).create(create, fields), {
      code: 'UNRESOLVED',
    });
    await assert.rejects(
      work(injected).create(create, {
        ...fields,
        reconcile_ticket_id: fixture,
      }),
      { code: 'UNRESOLVED' },
    );
    assert.equal(createCalls, 1);
    if (http) {
      const problem = z
        .object({ code: z.string() })
        .parse(await http('POST', '/tickets', 409, fields, create.key));
      assert.equal(problem.code, 'TICKET_UNRESOLVED');
    }
    console.log('PASS delayed evidence never reissues create');

    step = 'verified checkpoint and local commit failure';
    hideNotes = false;
    const failingOutbox: OutboxWriterPort = {
      append: () =>
        Promise.reject(new Error('Synthetic transactional failure')),
    };
    await assert.rejects(
      work(injected, failingOutbox).create(create, {
        ...fields,
        reconcile_ticket_id: fixture,
      }),
      { code: 'UNRESOLVED' },
    );
    assert.equal(
      await store.links(scope.instanceKey, scope.approvedGroupId, fixture),
      null,
    );
    const reconciliation = { ...fields, reconcile_ticket_id: fixture };
    const recoveredId = http
      ? ticketReceipt.parse(
          await http('POST', '/tickets', 201, reconciliation, create.key),
        ).data.ticket_id
      : (await work(injected).create(create, reconciliation)).externalTicketId;
    assert.equal(recoveredId, fixture);
    assert.equal(createCalls, 1);
    assert(
      await store.links(scope.instanceKey, scope.approvedGroupId, fixture),
    );
    console.log(
      'PASS positive create marker and verified checkpoint completed without reissue after local failure',
    );

    step = 'accepted Article with its result hidden';
    const articleOp = command();
    const body = 'One dedicated recovery note';
    await assert.rejects(
      work(injected).appendArticle(articleOp, fixture, body),
      { code: 'UNRESOLVED' },
    );
    loseArticleResponse = false;
    const ticketPath = '/tickets/' + fixture;
    const appendedId = http
      ? articleReceipt.parse(
          await http(
            'POST',
            ticketPath + '/articles',
            201,
            { body },
            articleOp.key,
          ),
        ).data.article_id
      : (await work(injected).appendArticle(articleOp, fixture, body))
          .articleId;
    assert.equal(articleCalls, 1);
    const articleRows = (await adapter.articles(fixture)).filter(
      (article) => article.text === body,
    );
    assert.equal(articleRows.length, 1);
    assert.equal(appendedId, articleRows[0].id);
    console.log(
      'PASS actual Article append recovered by exact marker without duplicate',
    );

    step = 'concurrent responsibility and Owner closure';
    await real.transition(command(), fixture, { state: 'OPEN' });
    const gate = blockedUntilReleased();
    const paused = work({
      ...injected,
      async update(id, changes) {
        assert.equal(id, fixture);
        await gate.wait();
        return adapter.update(id, changes);
      },
    });
    const transfer = paused.responsibilities(command(), fixture, {
      business_owner_user_id: technician,
    });
    try {
      await Promise.race([
        gate.entered,
        transfer.then(() => {
          throw new Error('Transfer passed the gate prematurely');
        }),
      ]);
      await assert.rejects(
        real.responsibilities(command(), fixture, {
          assignee_user_id: operator,
        }),
        { code: 'CONFLICT' },
      );
      await assert.rejects(
        real.close(command(), fixture, 'Conflicting stale Owner'),
        { code: 'CONFLICT' },
      );
      if (http) {
        await http(
          'PATCH',
          ticketPath + '/responsibilities',
          409,
          { assignee_user_id: operator },
          command().key,
        );
        await http(
          'POST',
          ticketPath + '/close',
          409,
          { outcome: 'Competing closure while owner transfer is locked' },
          command().key,
        );
      }
    } finally {
      gate.release();
      await transfer;
    }
    await assert.rejects(
      real.close(command(), fixture, 'Former Owner after transfer'),
      { code: 'DENIED' },
    );
    if (http) {
      await http(
        'POST',
        ticketPath + '/close',
        403,
        { outcome: 'Former Owner after transfer' },
        command().key,
      );
      console.log(
        'PASS HTTP duplicate prevention, reconciliation and stale Owner denial',
      );
    }
    const after = await read.getTicket(fixture);
    assert.equal(after?.stateId, (await adapter.states()).OPEN);
    assert.deepEqual(after?.businessOwner, {
      kind: 'reference',
      externalUserId: 5,
    });
    assert.equal(after?.nativeOwnerId, 5);
    console.log(
      JSON.stringify({
        fixture,
        check: 'bounded recovery and concurrent writes',
        result: 'PASS',
      }),
    );
  } finally {
    await app.close();
  }
}
void run().catch((error: unknown) => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : 'CHECK_FAILED';
  console.error(JSON.stringify({ step, result: 'FAIL', code }));
  process.exitCode = 1;
});

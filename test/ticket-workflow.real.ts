import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from '../src/app/core.module';
import { GetAuthorizedTicket } from '../src/modules/ticket/application/get-authorized-ticket';
import { TicketWorkflow } from '../src/modules/ticket/application/ticket-workflow';

const operator = '403678c5-a90b-4a06-9a7d-318f27a3c639';
const technician = '53cd2a15-5221-4f49-a822-3c56e4cca637';
const admin = '9c52d3fe-1bf7-4255-8654-6ec9c315070e';

async function run() {
  const knownFixture = process.env.FLOW04_EXISTING_WORKFLOW_FIXTURE;
  if (knownFixture === undefined)
    assert.equal(process.env.FLOW04_DISPOSABLE_WORKFLOW, 'true');
  assert.equal(process.env.ZAMMAD_BASE_URL, 'http://zammad-nginx:8080');
  assert.equal(process.env.ZAMMAD_INSTANCE_KEY, 'arimms-p0-generation-1');
  assert.equal(process.env.ZAMMAD_EXPECTED_GROUP_ID, '2');
  assert.equal(process.env.ZAMMAD_TICKET_CUSTOMER_ID, '7');

  const app = await NestFactory.createApplicationContext(CoreModule, {
    logger: false,
    abortOnError: false,
  });
  let step = 'initialize';
  try {
    const workflow = app.get(TicketWorkflow);
    const query = app.get(GetAuthorizedTicket);
    if (knownFixture !== undefined) {
      const id = Number(knownFixture);
      assert(Number.isSafeInteger(id) && id >= 12);
      step = 'canonical list and detail';
      const detail = await query.execute(operator, id);
      assert(detail.status === 'allowed');
      assert.match(detail.ticket.title, /^Disposable WF04 integration /);
      assert.equal((await query.execute(technician, 3)).status, 'denied');
      assert.equal((await query.execute(admin, id)).status, 'denied');
      const visible = await workflow.list(technician, {
        after: id - 1,
        page_size: 1,
        state: 'OPEN',
        priority_id: 3,
        assignee_user_id: technician,
      });
      assert.equal(visible.tickets[0]?.externalTicketId, id);
      assert(
        (await workflow.articlePage(technician, id, 0, 25)).articles.length >=
          2,
      );
      console.log(
        JSON.stringify({
          check: 'real canonical detail, scoped filtered list and Articles',
          result: 'PASS',
          fixture: id,
        }),
      );
      return;
    }
    const operation = (actor = operator) => ({ actor, key: randomUUID() });
    step = 'create';
    const createOperation = operation();
    const fields = {
      title: `Disposable WF04 integration ${randomUUID()}`,
      description: 'Dedicated local PoC workflow fixture.',
      priority_id: 2,
      business_owner_user_id: operator,
      assignee_user_id: operator,
    };
    const created = await workflow.create(createOperation, fields);
    const ticketId = created.externalTicketId;
    console.log(
      JSON.stringify({
        check: 'created-disposable-workflow-fixture',
        ticketId,
      }),
    );
    step = 'retry create';
    assert.equal(
      (await workflow.create(createOperation, fields)).externalTicketId,
      ticketId,
    );
    await assert.rejects(
      workflow.create(createOperation, {
        ...fields,
        title: 'Different normalized payload',
      }),
      { code: 'CONFLICT' },
    );
    step = 'permissions and assignment';
    assert.equal((await query.execute(admin, ticketId)).status, 'denied');
    assert.equal((await query.execute(technician, ticketId)).status, 'denied');
    await assert.rejects(
      workflow.responsibilities(operation(technician), ticketId, {
        assignee_user_id: technician,
      }),
      { code: 'DENIED' },
    );
    const assigned = await workflow.responsibilities(operation(), ticketId, {
      assignee_user_id: technician,
    });
    assert.deepEqual(assigned.businessOwner, created.businessOwner);
    assert.notEqual(assigned.nativeOwnerId, created.nativeOwnerId);
    assert.equal((await query.execute(technician, ticketId)).status, 'allowed');
    step = 'information';
    const updated = await workflow.updateInformation(operation(), ticketId, {
      title: fields.title + ' updated',
      priority_id: 3,
    });
    assert.equal(updated.priorityId, 3);
    step = 'progress';
    await assert.rejects(
      workflow.transition(operation(technician), ticketId, { state: 'OPEN' }),
      { code: 'DENIED' },
    );
    const opened = await workflow.transition(operation(), ticketId, {
      state: 'OPEN',
    });
    assert.notEqual(opened.stateId, created.stateId);
    const pending = await workflow.transition(operation(), ticketId, {
      state: 'PENDING',
      pending_until: new Date(Date.now() + 86_400_000).toISOString(),
    });
    assert.notEqual(pending.stateId, opened.stateId);
    assert.equal(
      (await workflow.transition(operation(), ticketId, { state: 'OPEN' }))
        .stateId,
      opened.stateId,
    );
    step = 'articles';
    await assert.rejects(
      workflow.appendArticle(
        operation(technician),
        ticketId,
        'Denied fixture note',
      ),
      { code: 'DENIED' },
    );
    const articleOp = operation();
    const first = await workflow.appendArticle(
      articleOp,
      ticketId,
      'Operator progress fixture note.',
    );
    assert.equal(
      (
        await workflow.appendArticle(
          articleOp,
          ticketId,
          'Operator progress fixture note.',
        )
      ).articleId,
      first.articleId,
    );
    assert(
      (await workflow.articlePage(technician, ticketId, 0, 25)).articles.some(
        (article) => article.id === first.articleId,
      ),
    );
    step = 'links';
    const links = await workflow.setLinks(operation(), ticketId, {
      assetIds: [],
    });
    assert.deepEqual(links, {
      assetIds: [],
      incidentId: null,
      maintenanceIds: [],
    });
    await assert.rejects(
      workflow.setLinks(operation(), ticketId, { assetIds: [randomUUID()] }),
      { code: 'INVALID' },
    );
    await assert.rejects(
      workflow.setLinks(operation(), ticketId, {
        incidentId: 'unavailable-fixture',
      }),
      { code: 'UNAVAILABLE' },
    );
    assert.deepEqual(await workflow.getLinks(technician, ticketId), links);
    step = 'owner-only closure and reopening';
    await workflow.responsibilities(operation(), ticketId, {
      business_owner_user_id: technician,
    });
    await assert.rejects(
      workflow.close(operation(), ticketId, 'Non-owner attempt'),
      { code: 'DENIED' },
    );
    assert.equal(
      (
        await workflow.transition(operation(), ticketId, {
          state: 'PENDING',
          pending_until: new Date(Date.now() + 86_400_000).toISOString(),
        })
      ).nativeOwnerId,
      assigned.nativeOwnerId,
    );
    await workflow.transition(operation(), ticketId, { state: 'OPEN' });
    await workflow.responsibilities(operation(), ticketId, {
      business_owner_user_id: operator,
    });
    const closed = await workflow.close(
      operation(),
      ticketId,
      'Disposable fixture closure',
    );
    assert.notEqual(closed.stateId, opened.stateId);
    await assert.rejects(
      workflow.reopen(operation(technician), ticketId, 'Denied reopening'),
      { code: 'DENIED' },
    );
    const reopened = await workflow.reopen(
      operation(),
      ticketId,
      'Disposable fixture reopen',
    );
    assert.equal(reopened.stateId, opened.stateId);
    assert.equal(reopened.externalTicketId, ticketId);
    assert(
      (await workflow.articlePage(technician, ticketId, 0, 25)).articles.some(
        (article) => article.id === first.articleId,
      ),
    );
    assert.deepEqual(await workflow.getLinks(technician, ticketId), links);
    console.log(
      JSON.stringify({
        check: 'workflow-with-actual-Zammad-Mongo-IAM-ports',
        result: 'PASS',
        fixture: ticketId,
      }),
    );
  } catch (error) {
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
        ? error.code
        : 'CHECK_FAILED';
    console.error(
      JSON.stringify({
        check: 'workflow-with-actual-Zammad-Mongo-IAM-ports',
        result: 'FAIL',
        step,
        code,
      }),
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void run().catch(() => {
  console.error('Real workflow runner failed to start (details withheld)');
  process.exitCode = 1;
});

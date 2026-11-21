const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { parse } = require('dotenv');

const base = 'http://localhost:8082/api/v1';
const operator = '403678c5-a90b-4a06-9a7d-318f27a3c639';
const technician = '53cd2a15-5221-4f49-a822-3c56e4cca637';
const administrator = '9c52d3fe-1bf7-4255-8654-6ec9c315070e';
const sessionVariables = [
  ['CORE_OPERATOR_TOKEN', operator, 'OPERATOR'],
  ['CORE_TECHNICIAN_TOKEN', technician, 'TECHNICIAN'],
  ['CORE_ADMIN_TOKEN', administrator, 'IT_ADMIN'],
];
let step = 'read ignored access tokens';

async function request(method, path, token, status, body, key = randomUUID()) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body
        ? {
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
  if (response.status !== status)
    throw Object.assign(new Error(), {
      actual: response.status,
      expected: status,
    });
  return response.json();
}

async function verifyWorkflow(op, tech, admin, techWork) {
  const title = 'Disposable WF04 HTTP finalization ' + randomUUID();
  const people = {
    business_owner_user_id: operator,
    assignee_user_id: operator,
  };
  const body = {
    title,
    description: 'Dedicated local API verification',
    priority_id: 2,
    ...people,
  };
  const key = randomUUID();
  step = 'operator creates and replays';
  const created = (await request('POST', '/tickets', op, 201, body, key)).data;
  const id = created.ticket_id;
  assert(Number.isSafeInteger(id) && id > 12);
  console.log(
    JSON.stringify({ fixture: id, check: 'created over authenticated HTTP' }),
  );
  const path = '/tickets/' + id;
  assert.equal(
    (await request('POST', '/tickets', op, 201, body, key)).data.ticket_id,
    id,
  );
  await request(
    'POST',
    '/tickets',
    op,
    409,
    { ...body, title: 'Conflicting payload' },
    key,
  );
  await request('POST', '/tickets', tech, 403, body);
  await request('POST', '/tickets/from-reviewed-draft', op, 503, {
    draft_id: 'unavailable-draft',
    revision: 'r1',
    priority_id: 2,
    ...people,
  });
  await request('GET', path, tech, 404);
  if (techWork) {
    await request('POST', path + '/status', tech, 404, { state: 'OPEN' });
    await request('POST', path + '/articles', tech, 404, {
      body: 'Unrelated Ticket must deny work',
    });
  }

  step = 'assignment and visibility';
  await request('PATCH', path + '/responsibilities', op, 200, {
    assignee_user_id: technician,
  });
  const { data: assigned } = await request('GET', path, tech, 200);
  assert.equal(assigned.ticket_id, id);
  await request('PATCH', path + '/responsibilities', tech, 403, {
    business_owner_user_id: technician,
  });
  await request('PATCH', path + '/responsibilities', tech, 403, {
    assignee_user_id: technician,
  });
  await request('PATCH', path, tech, 403, { priority_id: 3 });
  await request('PATCH', path + '/links', tech, 403, { asset_ids: [] });
  assert.deepEqual((await request('GET', path, op, 200)).data, assigned);
  if (!techWork) {
    await request('POST', path + '/status', tech, 403, { state: 'OPEN' });
    await request('POST', path + '/articles', tech, 403, {
      body: 'Current IAM policy denies Technician writes',
    });
  }
  const modified = (
    await request('PATCH', path, op, 200, {
      title: title + ' updated',
      priority_id: 3,
    })
  ).data;
  assert.equal(modified.priority_id, 3);

  step = 'progress and Articles';
  const workToken = techWork ? tech : op;
  const opened = (
    await request('POST', path + '/status', workToken, 200, { state: 'OPEN' })
  ).data;
  assert.notEqual(opened.state_id, created.state_id);
  await request('POST', path + '/status', workToken, 409, { state: 'OPEN' });
  assert.deepEqual((await request('GET', path, workToken, 200)).data, opened);
  const pending = (
    await request('POST', path + '/status', workToken, 200, {
      state: 'PENDING',
      pending_until: new Date(Date.now() + 3600000).toISOString(),
    })
  ).data;
  assert.notEqual(pending.state_id, opened.state_id);
  assert.equal(
    (await request('POST', path + '/status', workToken, 200, { state: 'OPEN' }))
      .data.state_id,
    opened.state_id,
  );
  const noteKey = randomUUID();
  const note = { body: 'Dedicated internal progress note' };
  const article = (
    await request('POST', path + '/articles', workToken, 201, note, noteKey)
  ).data;
  assert.equal(
    (await request('POST', path + '/articles', workToken, 201, note, noteKey))
      .data.article_id,
    article.article_id,
  );
  const before = (await request('GET', path + '/articles', tech, 200)).data;
  assert.equal(
    before.filter((entry) => entry.body_text === note.body).length,
    1,
  );
  assert(
    before.some(
      (entry) => entry.article_id === article.article_id && entry.internal,
    ),
  );

  step = 'links and lifecycle';
  const links = (
    await request('PATCH', path + '/links', op, 200, { asset_ids: [] })
  ).data;
  await request('PATCH', path + '/links', op, 503, {
    incident_id: 'unavailable-incident',
  });
  await request('PATCH', path + '/responsibilities', op, 200, {
    business_owner_user_id: technician,
  });
  const beforeDeniedClose = (await request('GET', path, op, 200)).data;
  await request('POST', path + '/close', op, 403, {
    outcome: 'Must fail for non-owner',
  });
  await request('POST', path + '/close', tech, 403, {
    outcome: 'Missing close capability',
  });
  assert.deepEqual(
    (await request('GET', path, op, 200)).data,
    beforeDeniedClose,
  );
  await request('PATCH', path + '/responsibilities', op, 200, {
    business_owner_user_id: operator,
  });
  const closed = (
    await request('POST', path + '/close', op, 200, {
      outcome: 'Verified fixture',
    })
  ).data;
  assert.notEqual(opened.state_id, closed.state_id);
  await request('POST', path + '/reopen', tech, 403, {
    reason: 'Missing management capability',
  });
  assert.deepEqual((await request('GET', path, op, 200)).data, closed);
  const reopened = (
    await request('POST', path + '/reopen', op, 200, {
      reason: 'Verify same Ticket',
    })
  ).data;
  assert.equal(reopened.ticket_id, id);
  assert.equal(reopened.state_id, opened.state_id);
  assert.deepEqual(
    (await request('GET', path + '/links', tech, 200)).data,
    links,
  );
  assert.deepEqual(
    (await request('GET', path + '/articles', tech, 200)).data,
    before,
  );
  await request('PATCH', path + '/responsibilities', op, 200, {
    assignee_user_id: operator,
  });
  await request('GET', path, tech, 404);
  if (techWork) {
    await request('POST', path + '/status', tech, 404, { state: 'OPEN' });
    await request('POST', path + '/articles', tech, 404, note, noteKey);
  }
  await request('PATCH', path + '/responsibilities', op, 200, {
    assignee_user_id: technician,
  });
  await request('GET', '/tickets?assignee_user_id=' + technician, tech, 200);
  await verifyAdmin(path, admin);

  step = 'human Audit attribution';
  const params = new URLSearchParams({
    resource_type: 'ticket',
    resource_id: JSON.stringify(['arimms-p0-generation-1', id]),
    page_size: '50',
  });
  let rows = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    rows = (await request('GET', '/audit/events?' + params, admin, 200)).data;
    if (
      rows.some((row) => row.action === 'ticket.reopened') &&
      rows.length >= 14
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  for (const action of [
    'created',
    'responsibilities_changed',
    'progressed',
    'article_added',
    'links_changed',
    'closed',
    'reopened',
  ])
    assert(
      rows.some(
        (row) =>
          row.action === 'ticket.' + action &&
          row.actor.type === 'user' &&
          row.actor.id ===
            (techWork && ['progressed', 'article_added'].includes(action)
              ? technician
              : operator),
      ),
    );
  assert.equal(
    rows.filter((row) => row.action === 'ticket.article_added').length,
    1,
  );
  console.log(
    JSON.stringify({
      fixture: id,
      check: 'disposable authenticated HTTP workflow',
      auditEvents: rows.length,
      status: 'PASS',
    }),
  );
}

async function verifyAdmin(path, admin) {
  step = 'IT_ADMIN denied';
  for (const route of [path, path + '/articles', path + '/links']) {
    await request('GET', route, admin, 404);
  }
  await request('GET', '/tickets', admin, 403);
  for (const [method, route, body] of [
    [
      'POST',
      '/tickets',
      {
        title: 'Disposable WF04 security probe',
        description: 'Security acceptance probe',
        priority_id: 2,
        business_owner_user_id: operator,
        assignee_user_id: technician,
      },
    ],
    [
      'POST',
      '/tickets/from-reviewed-draft',
      {
        draft_id: 'test-draft',
        revision: 'r1',
        priority_id: 2,
        business_owner_user_id: operator,
        assignee_user_id: technician,
      },
    ],
    ['PATCH', path, { priority_id: 2 }],
    ['PATCH', path + '/responsibilities', { assignee_user_id: technician }],
    ['POST', path + '/status', { state: 'OPEN' }],
    ['POST', path + '/articles', { body: 'Security acceptance probe' }],
    ['POST', path + '/close', { outcome: 'Security acceptance probe' }],
    ['POST', path + '/reopen', { reason: 'Security acceptance probe' }],
    ['PATCH', path + '/links', { asset_ids: [] }],
  ]) {
    await request(method, route, admin, 403, body);
  }
}

async function run() {
  const tokens = parse(readFileSync('.tmp/flow04-ticket-sessions.env'));
  const adminOnly = process.env.FLOW04_REAL_ROLE === 'IT_ADMIN';
  const techWork = process.env.FLOW04_EXPECT_TECH_WORK === 'true';
  const active = [];
  for (const [name, id, role] of sessionVariables) {
    if (adminOnly && role !== 'IT_ADMIN') continue;
    step = 'authentication for ' + role;
    const token = tokens[name];
    if (!token || !/^[A-Za-z0-9_.-]+$/.test(token))
      throw Object.assign(new Error(), { code: 'SESSION_UNAVAILABLE' });
    const { data } = await request('GET', '/auth/me', token, 200);
    assert.deepEqual(
      [data.user_id, data.role, data.status, data.must_change_password],
      [id, role, 'ACTIVE', false],
    );
    if (role === 'TECHNICIAN') {
      assert.equal(
        data.effective_permissions.includes('ticket:work'),
        techWork,
      );
      assert(!data.effective_permissions.includes('ticket:manage'));
      assert(!data.effective_permissions.includes('ticket:close'));
    }
    if (role === 'OPERATOR') {
      for (const permission of [
        'ticket:read',
        'ticket:create',
        'ticket:manage',
        'ticket:close',
      ]) {
        assert(data.effective_permissions.includes(permission));
      }
      assert.equal(
        data.effective_permissions.includes('ticket:work'),
        techWork,
      );
    }
    active.push(token);
    console.log(
      JSON.stringify({ check: 'actual-IAM-session', role, status: 'PASS' }),
    );
  }

  step = 'fixture verification';
  const id = Number(process.env.FLOW04_REAL_TICKET_FIXTURE_ID);
  assert(Number.isSafeInteger(id) && id >= 12);
  const path = '/tickets/' + id;
  if (adminOnly) {
    await verifyAdmin(path, active[0]);
    console.log(
      JSON.stringify({
        check: 'actual admin1 HTTP session denied all 13 Ticket operations',
        status: 'PASS',
        fixture: id,
      }),
    );
    return;
  }
  const [op, tech, admin] = active;
  if (process.env.FLOW04_DISPOSABLE_HTTP_WORKFLOW === 'true') {
    await verifyWorkflow(op, tech, admin, techWork);
    return;
  }
  const { data: opView } = await request('GET', path, op, 200);
  assert.equal(opView.ticket_id, id);
  assert.match(
    opView.title,
    /^Disposable WF04 (?:integration|HTTP finalization) /,
  );
  const { data: techView } = await request('GET', path, tech, 200);
  assert.deepEqual(opView, techView);
  assert.deepEqual(Object.keys(opView).sort(), [
    'created_at',
    'number',
    'priority_id',
    'state_id',
    'ticket_id',
    'title',
    'updated_at',
  ]);
  await request('GET', '/tickets/3', tech, 404);
  await request('GET', path + '/articles', tech, 200);
  await request('GET', path + '/links', tech, 200);
  await request('GET', '/tickets?assignee_user_id=' + technician, tech, 200);

  step = 'Technician gated writes';
  await request('PATCH', path + '/responsibilities', tech, 403, {
    business_owner_user_id: technician,
  });
  if (!techWork) {
    await request('POST', path + '/status', tech, 403, { state: 'OPEN' });
    await request('POST', path + '/articles', tech, 403, {
      body: 'Security acceptance probe',
    });
  }

  await verifyAdmin(path, admin);
  console.log(
    JSON.stringify({
      check: 'actual-IAM-HTTP-Ticket-verification',
      status: 'PASS',
      fixture: id,
    }),
  );
}

run().catch((error) => {
  const blocked =
    error?.code === 'ENOENT' ||
    error?.code === 'EACCES' ||
    error?.code === 'SESSION_UNAVAILABLE' ||
    (step.startsWith('authentication for ') && error?.actual === 401);
  console.error(
    JSON.stringify({
      status: blocked ? 'BLOCKED' : 'FAIL',
      step,
      actual: typeof error?.actual === 'number' ? error.actual : undefined,
      expected:
        typeof error?.expected === 'number' ? error.expected : undefined,
      code: error?.code,
    }),
  );
  process.exitCode = blocked ? 2 : 1;
});

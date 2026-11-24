/* eslint-disable @typescript-eslint/require-await -- Promise-returning test doubles model application ports. */
/* eslint-disable @typescript-eslint/unbound-method -- Jest matchers inspect mocked methods. */
import type { HumanAccessPort, HumanPrincipal } from '@modules/iam';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ZammadTicketWorkflowAdapter } from '../infrastructure/zammad-ticket-workflow.adapter';
import type { OutboxWriterPort, UnitOfWorkPort } from '@platform/events';
import type {
  AssetTopologyAssetQueries,
  AssetTypeId,
} from '@modules/asset-topology';
import type { IdentityMapping } from '../domain/identity-mapping';
import { GetAuthorizedTicket } from './get-authorized-ticket';
import {
  TicketJournal,
  type JournalResult,
  type TicketJournalStore,
  type TicketLinks,
  type TicketArchiveRecord,
} from './ticket-journal';
import type { ExternalTicket } from './ticket-read.port';
import type { TicketUpstreamPort } from './ticket-upstream.port';
import { TicketWorkflow } from './ticket-workflow';
import type { TicketWorkflowLinksPort } from './ticket-workflow-links.port';

const scope = { instanceKey: 'local-test', approvedGroupId: 2 };
const actor = 'actor-operator';
const tech = 'actor-technician';
const admin = 'actor-admin';
const operation = (user = actor) => ({ actor: user, key: 'fixture-operation' });

function setup(
  integrations?: TicketWorkflowLinksPort,
  technicianWork = false,
  loadStates?: TicketUpstreamPort['states'],
) {
  const fixture: ExternalTicket = {
    externalTicketId: 10,
    groupId: 2,
    title: 'Fixture',
    number: '11010',
    customerId: 7,
    nativeOwnerId: 5,
    businessOwner: { kind: 'reference', externalUserId: 4 },
    stateId: 12,
    priorityId: 2,
    createdAt: '2026-11-20T00:00:00Z',
    updatedAt: '2026-11-20T00:00:00Z',
  };
  const tickets = new Map<number, ExternalTicket>([
    [10, fixture],
    [11, { ...fixture, externalTicketId: 11, nativeOwnerId: 4 }],
    [
      12,
      { ...fixture, externalTicketId: 12, businessOwner: { kind: 'missing' } },
    ],
    [13, { ...fixture, externalTicketId: 13 }],
  ]);
  const iam: HumanAccessPort = {
    getPrincipal: jest.fn(
      async (id: string): Promise<HumanPrincipal | null> => {
        const role =
          id === actor
            ? 'OPERATOR'
            : id === tech
              ? 'TECHNICIAN'
              : id === admin
                ? 'IT_ADMIN'
                : null;
        return role === null ? null : { userId: id, role, status: 'ACTIVE' };
      },
    ),
    hasAllPermissions: jest.fn(
      async (id, codes) =>
        id !== tech ||
        codes.every(
          (permission) =>
            ['asset:read', 'ticket:read'].includes(permission) ||
            (technicianWork && permission === 'ticket:work'),
        ),
    ),
  };
  const mapping = (id: string, zammadUserId: number): IdentityMapping => ({
    ...scope,
    coreUserId: id,
    zammadUserId,
    status: 'ACTIVE',
    revision: 1,
    approvedByCoreUserId: admin,
    approvalReference: 'test-fixture',
    validatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const byCore = new Map([
    [actor, mapping(actor, 4)],
    [tech, mapping(tech, 5)],
  ]);
  const ticketRead = {
    getTicket: jest.fn(async (id: number) => tickets.get(id) ?? null),
  };
  const archives = new Map<number, TicketArchiveRecord>();
  const archiveStore = {
    archive: jest.fn(
      async (_i: string, _g: number, id: number) => archives.get(id) ?? null,
    ),
    archived: jest.fn(
      async (_i: string, _g: number, after: number, limit: number) =>
        [...archives.values()]
          .filter((row) => row.active && row.ticketId > after)
          .slice(0, limit),
    ),
  };
  const auth = new GetAuthorizedTicket(
    iam,
    {
      findActiveMapping: jest.fn(async (id) => byCore.get(id) ?? null),
      findActiveMappingByExternalId: jest.fn(
        async (id) =>
          [...byCore.values()].find((m) => m.zammadUserId === id) ?? null,
      ),
    },
    {
      getEligibleHuman: jest.fn(async (id) => ({
        externalUserId: id,
        groupId: 2,
      })),
    },
    ticketRead,
    scope,
    archiveStore,
  );
  let persistedLinks: TicketLinks | null = null;
  const store = {
    links: jest.fn(async () => persistedLinks),
    ...archiveStore,
  } as unknown as TicketJournalStore;
  const journal = new TicketJournal(
    store,
    {} as UnitOfWorkPort,
    {} as OutboxWriterPort,
  );
  const completed: JournalResult[] = [];
  jest.spyOn(journal, 'run').mockImplementation(async (_input, prepare) => {
    const result = await (await prepare())('test-marker');
    completed.push(result);
    if (result.links) persistedLinks = result.links;
    if (result.archive) archives.set(result.ticketId, result.archive);
    return result;
  });
  const rows: Awaited<ReturnType<TicketUpstreamPort['articles']>>[number][] =
    [];
  const upstream: TicketUpstreamPort = {
    create: jest.fn(async (input) => {
      tickets.set(20, {
        ...fixture,
        externalTicketId: 20,
        title: input.title,
        priorityId: input.priorityId,
        stateId: input.stateId,
        nativeOwnerId: input.assigneeId,
        businessOwner: { kind: 'reference', externalUserId: input.ownerId },
      });
      rows.push({
        id: 21,
        ticketId: 20,
        createdAt: fixture.createdAt,
        internal: true,
        type: 'note',
        text: input.body,
        subject: `AR-IMMS operation ${input.marker}`,
        createdBy: 6,
      });
      return 20;
    }),
    update: jest.fn(async (id, update) => {
      const before = tickets.get(id);
      if (!before) throw new Error();
      tickets.set(id, {
        ...before,
        stateId: update.state_id ?? before.stateId,
        nativeOwnerId: update.owner_id ?? before.nativeOwnerId,
        businessOwner: update.arimms_business_owner
          ? { kind: 'reference', externalUserId: update.arimms_business_owner }
          : before.businessOwner,
        pendingUntil: update.pending_time ?? before.pendingUntil,
      });
    }),
    append: jest.fn(async (ticketId, body, marker) => {
      rows.push({
        id: 22,
        ticketId,
        createdAt: fixture.createdAt,
        internal: true,
        type: 'note',
        text: body,
        subject: `AR-IMMS operation ${marker}`,
        createdBy: 6,
      });
      return 22;
    }),
    articles: jest.fn(async () => rows),
    search: jest.fn(async ({ after, limit }) =>
      [10, 11, 12, 13].filter((id) => id > after).slice(0, limit),
    ),
    states:
      loadStates ??
      jest.fn(async () => ({
        NEW: 11,
        OPEN: 12,
        PENDING: 13,
        CLOSED: 14,
      })),
    priorityAvailable: jest.fn(async () => true),
  };
  const assets: Pick<AssetTopologyAssetQueries, 'getAsset'> = {
    getAsset: jest.fn(
      async (id): ReturnType<AssetTopologyAssetQueries['getAsset']> =>
        id.startsWith('asset-')
          ? {
              id,
              name: id,
              assetTypeId: 'fixture-type' as AssetTypeId,
              lifecycleState: 'ACTIVE',
              currentPlacement: null,
            }
          : null,
    ),
  };
  const listed = [actor, tech, admin].sort();
  const directory = {
    candidates: {
      listCandidates: jest.fn(async (after: string | undefined) =>
        listed
          .map((id) => ({ id, cursor: 'position-' + id }))
          .filter((row) => !after || row.cursor > after),
      ),
    },
    identities: {
      getIdentity: jest.fn(async (id: string) => {
        const principal = await iam.getPrincipal(id);
        return principal
          ? {
              ...principal,
              username: id,
              displayName: id === tech ? 'Named Technician' : null,
            }
          : null;
      }),
    },
  };
  const workflow = new TicketWorkflow(
    auth,
    iam,
    upstream,
    ticketRead,
    journal,
    store,
    assets,
    scope,
    6,
    integrations,
    directory,
  );
  return {
    workflow,
    upstream,
    tickets,
    fixture,
    iam,
    journal,
    completed,
    byCore,
    auth,
    directory,
  };
}

describe('Ticket business workflow', () => {
  it('finds eligible users by authorized name with cursor, omits missing mappings and denies other actors', async () => {
    const { workflow, byCore, directory } = setup();
    await expect(workflow.eligibleUsers(tech, '', 10)).rejects.toMatchObject({
      code: 'DENIED',
    });
    await expect(workflow.eligibleUsers(admin, '', 10)).rejects.toMatchObject({
      code: 'DENIED',
    });
    expect(directory.candidates.listCandidates).not.toHaveBeenCalled();
    await expect(workflow.eligibleUsers(actor, '', 1)).resolves.toEqual({
      items: [
        {
          id: actor,
          username: actor,
          display_name: null,
          role: 'OPERATOR',
          status: 'ACTIVE',
        },
      ],
      next: 'position-' + actor,
    });
    await expect(
      workflow.eligibleUsers(actor, 'NAMED', 10, 'position-' + actor),
    ).resolves.toEqual({
      items: [
        {
          id: tech,
          username: tech,
          display_name: 'Named Technician',
          role: 'TECHNICIAN',
          status: 'ACTIVE',
        },
      ],
      next: null,
    });
    const profile = await directory.identities.getIdentity(tech);
    if (!profile) throw new Error('missing fixture');
    directory.identities.getIdentity.mockResolvedValueOnce({
      ...profile,
      status: 'INACTIVE',
    });
    await expect(
      workflow.eligibleUsers(actor, 'Named', 10, 'position-' + actor),
    ).resolves.toEqual({ items: [], next: null });
    byCore.delete(tech);
    await expect(
      workflow.eligibleUsers(actor, 'Named', 10, 'position-' + actor),
    ).resolves.toEqual({ items: [], next: null });
    await expect(
      workflow.responsibilities(operation(), 10, { assignee_user_id: tech }),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('TC-WF04-03: rejects unauthorized creation before journaling or the upstream call', async () => {
    const { workflow, upstream, journal } = setup(undefined, true);
    const input = {
      title: 'Fixture',
      description: 'Fixture note',
      priority_id: 2,
      business_owner_user_id: actor,
      assignee_user_id: tech,
    };
    for (const user of [tech, admin]) {
      await expect(
        workflow.create(operation(user), input),
      ).rejects.toMatchObject({ code: 'DENIED' });
    }
    expect(journal.run).not.toHaveBeenCalled();
    expect(upstream.create).not.toHaveBeenCalled();
  });

  it('TC-WF04-19: rejects repeated OPEN without an upstream update', async () => {
    const { workflow, upstream } = setup(undefined, true);
    await expect(
      workflow.transition(operation(tech), 10, { state: 'OPEN' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(upstream.update).not.toHaveBeenCalled();
  });

  it('TC-WF04-19: rejects repeated OPEN using the HTTP state catalog without a write', async () => {
    const calls: string[] = [];
    const server = createServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      const records = ['new', 'open', 'pending reminder', 'closed'].map(
        (name, index) => ({
          id: 11 + index,
          name,
          active: true,
          next_state_id: null,
        }),
      );
      res
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(records));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const adapter = new ZammadTicketWorkflowAdapter(
        {
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          apiToken: 'fake-test-token',
          expectedGroupId: 2,
          timeoutMs: 2000,
        },
        7,
      );
      const { workflow, upstream } = setup(undefined, true, () =>
        adapter.states(),
      );
      await expect(
        workflow.transition(operation(tech), 10, { state: 'OPEN' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(calls).toEqual(['GET /api/v1/ticket_states']);
      expect(upstream.update).not.toHaveBeenCalled();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('validates multiple Assets and uses the owning contract to attach a Maintenance reference', async () => {
    const integration: TicketWorkflowLinksPort = {
      reviewedDraft: jest.fn(async () => null),
      confirmedIncident: jest.fn(async () => false),
      maintenanceActivity: jest.fn(
        async (_actor, activityId, ticketId) =>
          activityId === 'activity-1' && ticketId === 10,
      ),
    };
    const { workflow } = setup(integration);
    await expect(
      workflow.setLinks(operation(), 10, { assetIds: ['asset-2', 'asset-1'] }),
    ).resolves.toEqual({
      assetIds: ['asset-1', 'asset-2'],
      incidentId: null,
      maintenanceIds: [],
    });
    await expect(
      workflow.linkMaintenanceActivity(operation(), 10, 'invalid'),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      workflow.linkMaintenanceActivity(operation(), 10, 'activity-1'),
    ).resolves.toMatchObject({
      maintenanceIds: ['activity-1'],
    });
    await expect(workflow.getLinks(tech, 10)).resolves.toMatchObject({
      assetIds: ['asset-1', 'asset-2'],
    });
    await expect(
      setup().workflow.linkMaintenanceActivity(operation(), 10, 'activity-1'),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('emits only an authorized next cursor after skipping unrelated and imported candidates', async () => {
    const { workflow, upstream } = setup();
    const page = await workflow.list(tech, { after: 0, page_size: 1 });
    expect(page.tickets.map((t) => t.externalTicketId)).toEqual([10]);
    expect(page.next).toBe(10);
    expect(upstream.search).toHaveBeenCalledWith(
      expect.objectContaining({ visibleTo: 5 }),
    );
    expect(
      (await workflow.list(tech, { after: 10, page_size: 3 })).tickets.map(
        (t) => t.externalTicketId,
      ),
    ).toEqual([13]);
  });

  it('denies IT_ADMIN before searching or dispatching a management write', async () => {
    const { workflow, upstream } = setup();
    await expect(
      workflow.list(admin, { after: 0, page_size: 1 }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      workflow.responsibilities(operation(admin), 10, {
        assignee_user_id: actor,
      }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    expect(upstream.search).not.toHaveBeenCalled();
    expect(upstream.update).not.toHaveBeenCalled();
  });

  it('applies an independent Assignee update and refuses technician self-grants', async () => {
    const { workflow, upstream, fixture } = setup();
    await expect(
      workflow.responsibilities(operation(tech), 10, {
        business_owner_user_id: tech,
      }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    const changed = await workflow.responsibilities(operation(), 10, {
      assignee_user_id: actor,
    });
    expect(changed.businessOwner).toEqual(fixture.businessOwner);
    expect(upstream.update).toHaveBeenCalledTimes(1);
    expect(upstream.update).toHaveBeenCalledWith(10, { owner_id: 4 });
  });

  it('denies non-owner close and permits Operator reopening through the dedicated transition', async () => {
    const { workflow, upstream } = setup();
    await workflow.responsibilities(operation(), 10, {
      business_owner_user_id: tech,
    });
    await expect(
      workflow.close(operation(), 10, 'Outcome'),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      workflow.reopen(operation(), 10, 'Reason'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(upstream.update).toHaveBeenCalledTimes(1);
    await workflow.responsibilities(operation(), 10, {
      business_owner_user_id: actor,
    });
    const closed = await workflow.close(operation(), 10, 'Outcome');
    expect(closed.stateId).toBe(14);
    expect((await workflow.reopen(operation(), 10, 'Reason')).stateId).toBe(12);
  });

  it('lets an assigned Technician start, pause, resume and add an internal note with ticket:work', async () => {
    const { workflow, upstream, tickets, fixture, completed } = setup(
      undefined,
      true,
    );
    tickets.set(10, { ...fixture, stateId: 11 });
    await expect(
      workflow.transition(operation(tech), 10, { state: 'OPEN' }),
    ).resolves.toMatchObject({ stateId: 12 });
    await expect(
      workflow.transition(operation(tech), 10, {
        state: 'PENDING',
        pending_until: new Date(Date.now() + 3600000).toISOString(),
      }),
    ).resolves.toMatchObject({ stateId: 13 });
    await expect(
      workflow.transition(operation(tech), 10, { state: 'OPEN' }),
    ).resolves.toMatchObject({ stateId: 12 });
    await expect(
      workflow.appendArticle(operation(tech), 10, 'Scoped field note'),
    ).resolves.toMatchObject({ articleId: 22 });
    expect(upstream.append).toHaveBeenCalledTimes(1);
    expect(completed.map((result) => result.notification)).toEqual([
      { kind: 'progressed', recipients: [5, 4] },
      { kind: 'progressed', recipients: [5, 4] },
      { kind: 'progressed', recipients: [5, 4] },
      { kind: 'article_added', recipients: [5, 4] },
    ]);
  });

  it('does not expand Technician scope or grant management with ticket:work', async () => {
    const { workflow, upstream } = setup(undefined, true);
    await expect(
      workflow.appendArticle(operation(tech), 11, 'Unrelated'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await workflow.responsibilities(operation(), 10, {
      assignee_user_id: actor,
    });
    await expect(
      workflow.appendArticle(operation(tech), 10, 'Removed'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      workflow.responsibilities(operation(tech), 10, {
        business_owner_user_id: tech,
      }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      workflow.responsibilities(operation(tech), 10, {
        assignee_user_id: tech,
      }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      workflow.setLinks(operation(tech), 10, { assetIds: [] }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      workflow.close(operation(tech), 10, 'Denied'),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      workflow.reopen(operation(tech), 10, 'Denied'),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      workflow.appendArticle(operation(admin), 10, 'Denied'),
    ).rejects.toMatchObject({ code: 'DENIED' });
    expect(upstream.append).not.toHaveBeenCalled();
  });

  it.each(['missing', 'revoked', 'wrong group'] as const)(
    'refuses to dispatch work when the Technician mapping is %s',
    async (mappingCase) => {
      const { workflow, upstream, byCore, tickets, fixture, journal } = setup(
        undefined,
        true,
      );
      tickets.set(10, { ...fixture, stateId: 11 });
      const mapping = byCore.get(tech);
      if (!mapping) throw new Error('Missing Technician fixture mapping');
      if (mappingCase === 'missing') byCore.delete(tech);
      else if (mappingCase === 'revoked')
        byCore.set(tech, { ...mapping, status: 'REVOKED' });
      else
        byCore.set(tech, {
          ...mapping,
          approvedGroupId: scope.approvedGroupId + 1,
        });
      await expect(
        workflow.transition(operation(tech), 10, { state: 'OPEN' }),
      ).rejects.toMatchObject({ code: 'DENIED' });
      await expect(
        workflow.appendArticle(operation(tech), 10, 'Denied'),
      ).rejects.toMatchObject({ code: 'DENIED' });
      expect(journal.run).not.toHaveBeenCalled();
      expect(upstream.update).not.toHaveBeenCalled();
      expect(upstream.append).not.toHaveBeenCalled();
    },
  );

  it('keeps close and reopen denied even when a work-only Technician is the current Owner', async () => {
    const { workflow, upstream, tickets, fixture } = setup(undefined, true);
    const owned = {
      ...fixture,
      businessOwner: { kind: 'reference', externalUserId: 5 },
    } as const;
    tickets.set(10, owned);
    await expect(
      workflow.close(operation(tech), 10, 'Denied'),
    ).rejects.toMatchObject({ code: 'DENIED' });
    tickets.set(10, { ...owned, stateId: 14 });
    await expect(
      workflow.reopen(operation(tech), 10, 'Denied'),
    ).rejects.toMatchObject({ code: 'DENIED' });
    expect(upstream.update).not.toHaveBeenCalled();
  });

  it('denies Technician progress and append under the unchanged permission catalog', async () => {
    const { workflow, upstream } = setup();
    await expect(
      workflow.transition(operation(tech), 10, { state: 'OPEN' }),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      workflow.appendArticle(operation(tech), 10, 'note'),
    ).rejects.toMatchObject({ code: 'DENIED' });
    expect(upstream.update).not.toHaveBeenCalled();
    expect(upstream.append).not.toHaveBeenCalled();
  });

  it('blocks missing owner integration and invalid asset references before dispatch', async () => {
    const { workflow, upstream } = setup();
    const base = {
      title: 'Reviewed',
      description: 'text',
      priority_id: 2,
      business_owner_user_id: actor,
      assignee_user_id: tech,
    };
    await expect(
      workflow.createReviewedDraft(operation(), {
        ...base,
        draft_id: 'draft',
        revision: 'r1',
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(
      workflow.create(operation(), { ...base, asset_ids: ['missing'] }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect(upstream.create).not.toHaveBeenCalled();
  });

  it('uses the owning draft and Confirmed Incident ports without mutating their lifecycle', async () => {
    const api: TicketWorkflowLinksPort = {
      reviewedDraft: jest.fn(async (_actor, _draft, revision) =>
        revision === 'r1'
          ? {
              incidentId: 'confirmed-1',
              title: 'Reviewed title',
              description: 'Description',
              assetIds: [],
            }
          : null,
      ),
      confirmedIncident: jest.fn(async () => true),
      maintenanceActivity: jest.fn(async () => false),
    };
    const { workflow, upstream } = setup(api);
    const input = {
      draft_id: 'draft-1',
      revision: 'r1',
      priority_id: 2,
      business_owner_user_id: actor,
      assignee_user_id: tech,
    };
    await expect(
      workflow.createReviewedDraft(operation(), {
        ...input,
        revision: 'stale',
      }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      workflow.createReviewedDraft(operation(), input),
    ).resolves.toMatchObject({ title: 'Reviewed title', nativeOwnerId: 5 });
    expect(api.confirmedIncident).toHaveBeenCalledWith(actor, 'confirmed-1');
    expect(upstream.create).toHaveBeenCalledTimes(1);
  });
});

describe('Core archive visibility', () => {
  it('archives separately from canonical Ticket, guards every normal path and restores the same Ticket and Articles', async () => {
    const { workflow, upstream, tickets, fixture, auth } = setup(
      undefined,
      true,
    );
    await workflow.appendArticle(
      { ...operation(tech), key: 'seed-article-local' },
      10,
      'note retained',
    );
    await expect(
      workflow.archive(operation(), 10, 'wrong request', true),
    ).resolves.toMatchObject({ ticketId: 10, active: true, version: 1 });
    const visible = await workflow.list(actor, { after: 0, page_size: 20 });
    expect(
      visible.tickets.some(
        (item) => item.externalTicketId === fixture.externalTicketId,
      ),
    ).toBe(false);
    await expect(auth.execute(tech, 10)).resolves.toEqual({
      status: 'not_found',
    });
    await expect(auth.execute(actor, 10)).resolves.toEqual({
      status: 'not_found',
    });
    await expect(workflow.archived(actor, 0, 20)).resolves.toMatchObject({
      items: [{ ticket: fixture, record: { active: true } }],
    });
    await expect(workflow.archived(tech, 0, 20)).rejects.toMatchObject({
      code: 'DENIED',
    });
    await expect(
      workflow.evidenceAccess(actor, 10, false),
    ).resolves.toBeUndefined();
    await expect(
      workflow.evidenceAccess(tech, 10, false),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      workflow.evidenceAccess(actor, 10, true),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      workflow.transition(operation(tech), 10, { state: 'OPEN' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      workflow.appendArticle(operation(tech), 10, 'blocked'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      workflow.archive(
        { ...operation(), key: 'fresh-restore-key' },
        10,
        'valid after all',
        false,
      ),
    ).resolves.toMatchObject({ ticketId: 10, active: false, version: 2 });
    expect(tickets.get(10)).toEqual(fixture);
    await expect(upstream.articles(10)).resolves.toEqual([
      expect.objectContaining({ text: 'note retained' }),
    ]);
    expect(upstream.update).not.toHaveBeenCalled();
  });
  it('denies Technician, IT Admin, and an inaccessible Ticket', async () => {
    const { workflow } = setup(undefined, true);
    await expect(
      workflow.archive(operation(tech), 10, 'reason', true),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      workflow.archive(operation(admin), 10, 'reason', true),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      workflow.archive(operation(), 999, 'reason', true),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

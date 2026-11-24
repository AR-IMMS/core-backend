import type {
  HumanAccessPort,
  HumanDirectoryPort,
  PermissionCode,
} from '@modules/iam';
import type {
  AssetId,
  AssetTopologyAssetQueries,
} from '@modules/asset-topology';
import type { MappingScope } from '../domain/identity-mapping';
import { GetAuthorizedTicket } from './get-authorized-ticket';
import {
  notificationFor,
  type TicketNotificationKind,
} from './ticket-notifications';
import {
  TicketJournal,
  TicketOperationError,
  type JournalResult,
  type TicketJournalStore,
  type TicketLinks,
  type TicketArchiveRecord,
} from './ticket-journal';
import type { ExternalTicket, TicketReadPort } from './ticket-read.port';
import type {
  TicketChanges,
  TicketState,
  TicketUpstreamPort,
} from './ticket-upstream.port';
import type { TicketWorkflowLinksPort } from './ticket-workflow-links.port';
import type { IdentityMappingDirectory } from './identity-mapping-read.port';

export interface TicketActorOperation {
  readonly actor: string;
  readonly key: string;
}

export interface ManualTicketInput {
  readonly title: string;
  readonly description: string;
  readonly priority_id: number;
  readonly business_owner_user_id: string;
  readonly assignee_user_id: string;
  readonly incident_id?: string;
  readonly asset_ids?: readonly string[];
  readonly reconcile_ticket_id?: number;
}

export interface TicketListInput {
  readonly after: number;
  readonly page_size: number;
  readonly state?: TicketState;
  readonly priority_id?: number;
  readonly business_owner_user_id?: string;
  readonly assignee_user_id?: string;
  readonly search?: string;
}

const emptyLinks: TicketLinks = {
  incidentId: null,
  assetIds: [],
  maintenanceIds: [],
};
const ownerOf = (ticket: ExternalTicket) =>
  ticket.businessOwner.kind === 'reference'
    ? ticket.businessOwner.externalUserId
    : null;

export class TicketWorkflow {
  constructor(
    private readonly authorization: GetAuthorizedTicket,
    private readonly iam: HumanAccessPort,
    private readonly upstream: TicketUpstreamPort,
    private readonly tickets: TicketReadPort,
    private readonly journal: TicketJournal,
    private readonly store: TicketJournalStore,
    private readonly assets: Pick<AssetTopologyAssetQueries, 'getAsset'>,
    private readonly scope: MappingScope,
    private readonly serviceUserId: number,
    private readonly integrations?: TicketWorkflowLinksPort,
    private readonly directory?: {
      identities: HumanDirectoryPort;
      candidates: IdentityMappingDirectory;
    },
  ) {}

  async priorities(actor: string) {
    await this.actor(actor);
    if (!this.upstream.priorities)
      throw new TicketOperationError('UNAVAILABLE');
    return this.upstream.priorities();
  }

  async eligibleUsers(
    actor: string,
    search: string,
    pageSize: number,
    after?: string,
  ) {
    await this.actor(actor, ['ticket:manage'], true);
    if (!this.directory) throw new TicketOperationError('UNAVAILABLE');
    const { candidates, identities } = this.directory;
    // Bound database and upstream work even when most mappings do not match.
    const rows = await candidates.listCandidates(after, 51);
    const matches = [];
    const query = search.toLowerCase().normalize('NFC');
    for (let offset = 0; offset < Math.min(rows.length, 50); offset += 5) {
      const batch = rows.slice(offset, offset + 5);
      const visible = await Promise.all(
        batch.map(async ({ id }) => {
          const profile = await identities.getIdentity(id);
          if (
            !profile ||
            profile.userId !== id ||
            profile.status !== 'ACTIVE' ||
            (profile.role !== 'OPERATOR' && profile.role !== 'TECHNICIAN') ||
            ![profile.username, profile.displayName].some((name) =>
              name?.toLowerCase().normalize('NFC').includes(query),
            )
          )
            return null;
          const current = await this.authorization.authorizeActor(id);
          if (!current || current.actor.role !== profile.role) return null;
          return {
            id,
            username: profile.username,
            display_name: profile.displayName,
            role: profile.role,
            status: 'ACTIVE' as const,
          };
        }),
      );
      for (const [index, item] of visible.entries()) {
        if (item) matches.push(item);
        if (matches.length === pageSize) {
          const position = offset + index;
          return {
            items: matches,
            next: position + 1 < rows.length ? rows[position].cursor : null,
          };
        }
      }
    }
    return {
      items: matches,
      next: rows.length === 51 ? rows[49].cursor : null,
    };
  }

  async archived(actor: string, after: number, pageSize: number) {
    await this.actor(actor, ['ticket:manage'], true);
    if (!this.store.archived) throw new TicketOperationError('UNAVAILABLE');
    const rows = await this.store.archived(
      this.scope.instanceKey,
      this.scope.approvedGroupId,
      after,
      pageSize + 1,
    );
    const items: { ticket: ExternalTicket; record: TicketArchiveRecord }[] = [];
    for (const record of rows.slice(0, pageSize)) {
      const result = await this.authorization.execute(actor, record.ticketId, {
        archivedOperator: true,
      });
      if (result.status === 'allowed')
        items.push({ ticket: result.ticket, record });
    }
    return {
      items,
      next: rows.length > pageSize ? rows[pageSize - 1].ticketId : null,
    };
  }

  async archive(
    operation: TicketActorOperation,
    ticketId: number,
    reason: string,
    active: boolean,
  ) {
    await this.archiveAccess(operation.actor, ticketId);
    const prepare = async () => {
      await this.archiveAccess(operation.actor, ticketId);
      if (!this.store.archive) throw new TicketOperationError('UNAVAILABLE');
      const existing = await this.store.archive(
        this.scope.instanceKey,
        this.scope.approvedGroupId,
        ticketId,
      );
      if (active ? existing?.active : !existing?.active)
        throw new TicketOperationError('CONFLICT');
      const now = new Date().toISOString();
      const version = (existing?.version ?? 0) + 1;
      const record: TicketArchiveRecord = active
        ? {
            instance: this.scope.instanceKey,
            group: this.scope.approvedGroupId,
            ticketId,
            archivedAt: now,
            archivedByUserId: operation.actor,
            archiveReason: reason,
            active,
            version,
          }
        : {
            ...existing,
            instance: this.scope.instanceKey,
            group: this.scope.approvedGroupId,
            ticketId,
            archivedAt: existing?.archivedAt ?? now,
            archivedByUserId: existing?.archivedByUserId ?? operation.actor,
            archiveReason: existing?.archiveReason ?? reason,
            active,
            version,
            restoredAt: now,
            restoredByUserId: operation.actor,
            restoreReason: reason,
          };
      return {
        ticketId,
        archive: record,
        changes: [
          { field: 'archived', before: !active, after: active },
          { field: 'reason', after: reason },
        ],
      };
    };
    const result = await this.journal.run(
      this.intent(
        operation,
        active ? 'archived' : 'restored',
        { reason },
        ticketId,
      ),
      async () => {
        const snapshot = await prepare();
        return () => Promise.resolve(snapshot);
      },
      prepare,
    );
    if (!result.archive) throw new TicketOperationError('UNAVAILABLE');
    return result.archive;
  }

  async evidenceAccess(actor: string, ticketId: number, write: boolean) {
    if (write) await this.actor(actor, ['ticket:work']);
    const archived = (
      await this.store.archive?.(
        this.scope.instanceKey,
        this.scope.approvedGroupId,
        ticketId,
      )
    )?.active;
    if (archived && !write) await this.archiveAccess(actor, ticketId);
    else return (await this.resource(actor, ticketId)).ticket;
  }

  private async archiveAccess(actor: string, ticketId: number) {
    await this.actor(actor, ['ticket:manage'], true);
    if (
      (
        await this.authorization.execute(actor, ticketId, {
          archivedOperator: true,
        })
      ).status !== 'allowed'
    )
      throw new TicketOperationError('NOT_FOUND');
  }

  create(operation: TicketActorOperation, input: ManualTicketInput) {
    return this.createFrom(operation, input, 'created');
  }

  async createReviewedDraft(
    operation: TicketActorOperation,
    input: Pick<
      ManualTicketInput,
      'priority_id' | 'business_owner_user_id' | 'assignee_user_id'
    > & { draft_id: string; revision: string },
  ) {
    await this.actor(operation.actor, ['ticket:create'], true);
    if (!this.integrations) throw new TicketOperationError('UNAVAILABLE');
    const draft = await this.integrations.reviewedDraft(
      operation.actor,
      input.draft_id,
      input.revision,
    );
    if (!draft) throw new TicketOperationError('INVALID');
    return this.createFrom(
      {
        ...operation,
        key: `reviewed-draft:${input.draft_id}:${input.revision}`,
      },
      {
        title: draft.title,
        description: draft.description,
        priority_id: input.priority_id,
        business_owner_user_id: input.business_owner_user_id,
        assignee_user_id: input.assignee_user_id,
        incident_id: draft.incidentId,
        asset_ids: draft.assetIds,
      },
      'created_from_reviewed_draft',
    );
  }

  private async createFrom(
    operation: TicketActorOperation,
    input: ManualTicketInput,
    action: string,
  ) {
    await this.actor(operation.actor, ['ticket:create'], true);
    const links = {
      incidentId: input.incident_id ?? null,
      assetIds: [...(input.asset_ids ?? [])].sort(),
      maintenanceIds: [],
    };
    const payload = {
      title: input.title,
      description: input.description,
      priority: input.priority_id,
      owner: input.business_owner_user_id,
      assignee: input.assignee_user_id,
      links,
    };
    const verifyCreation = async (
      ticketId: number,
      marker: string,
      owner: number,
      assignee: number,
      newState: number,
    ): Promise<JournalResult> => {
      const ticket = await this.readback(ticketId);
      if (
        ticket.title !== payload.title ||
        ticket.priorityId !== payload.priority ||
        ticket.stateId !== newState ||
        ownerOf(ticket) !== owner ||
        ticket.nativeOwnerId !== assignee
      )
        throw new TicketOperationError('UNRESOLVED');
      await this.verifyArticle(ticketId, marker, payload.description);
      return {
        ticketId,
        links,
        notification: notificationFor('created', ticket),
        changes: [
          { field: 'business_owner', after: owner },
          { field: 'assignee', after: assignee },
          { field: 'state_id', after: newState },
          { field: 'priority_id', after: payload.priority },
          ...this.linkAudit(emptyLinks, links),
        ],
      };
    };
    const recoverId = input.reconcile_ticket_id;
    const result = await this.journal.run(
      {
        ...this.intent(operation, action, payload),
        reconcileOnly: recoverId !== undefined,
      },
      async () => {
        const owner = await this.target(payload.owner);
        const assignee = await this.target(payload.assignee);
        const states = await this.upstream.states();
        await this.priority(input.priority_id);
        await this.validateLinks(operation.actor, links);
        await this.actor(operation.actor, ['ticket:create'], true);
        return async (marker) => {
          const ticketId = await this.upstream.create({
            title: payload.title,
            body: payload.description,
            priorityId: payload.priority,
            stateId: states.NEW,
            ownerId: owner,
            assigneeId: assignee,
            marker,
          });
          return verifyCreation(ticketId, marker, owner, assignee, states.NEW);
        };
      },
      recoverId === undefined
        ? undefined
        : async (marker) => {
            await this.resource(operation.actor, recoverId);
            const [owner, assignee, states] = await Promise.all([
              this.target(payload.owner),
              this.target(payload.assignee),
              this.upstream.states(),
            ]);
            await this.validateLinks(operation.actor, links);
            return verifyCreation(
              recoverId,
              marker,
              owner,
              assignee,
              states.NEW,
            );
          },
    );
    return (await this.resource(operation.actor, result.ticketId)).ticket;
  }

  async list(actorId: string, input: TicketListInput) {
    const { actor, mapping } = await this.actor(actorId);
    const stateId = input.state
      ? (await this.upstream.states())[input.state]
      : undefined;
    const ownerId = input.business_owner_user_id
      ? await this.optionalTarget(input.business_owner_user_id)
      : undefined;
    const assigneeId = input.assignee_user_id
      ? await this.optionalTarget(input.assignee_user_id)
      : undefined;
    if (ownerId === null || assigneeId === null)
      return { tickets: [], next: null };
    const tickets: ExternalTicket[] = [];
    let after = input.after;
    const batch = Math.min(25, input.page_size + 1);
    for (let page = 0; page < 8; page++) {
      const ids = await this.upstream.search({
        after,
        limit: batch,
        stateId,
        priorityId: input.priority_id,
        ownerId,
        assigneeId,
        visibleTo:
          actor.role === 'TECHNICIAN' ? mapping.zammadUserId : undefined,
        search: input.search,
      });
      for (const id of ids) {
        const result = await this.authorization.execute(actorId, id);
        if (result.status !== 'allowed') continue;
        const { ticket } = result;
        if (
          (stateId !== undefined && ticket.stateId !== stateId) ||
          (input.priority_id !== undefined &&
            ticket.priorityId !== input.priority_id) ||
          (ownerId !== undefined && ownerOf(ticket) !== ownerId) ||
          (assigneeId !== undefined && ticket.nativeOwnerId !== assigneeId) ||
          (input.search &&
            !ticket.title.toLowerCase().includes(input.search.toLowerCase()))
        )
          continue;
        if (tickets.length === input.page_size)
          return {
            tickets,
            next: tickets[tickets.length - 1].externalTicketId,
          };
        tickets.push(ticket);
      }
      if (ids.length < batch) return { tickets, next: null };
      after = ids[ids.length - 1];
    }
    throw new TicketOperationError('UNAVAILABLE');
  }

  async responsibilities(
    operation: TicketActorOperation,
    ticketId: number,
    input: {
      business_owner_user_id?: string;
      assignee_user_id?: string;
    },
  ) {
    const payload = {
      owner: input.business_owner_user_id,
      assignee: input.assignee_user_id,
    };
    return this.change(
      operation,
      ticketId,
      'responsibilities_changed',
      payload,
      ['ticket:manage'],
      true,
      async (before) => {
        const owner =
          payload.owner === undefined
            ? undefined
            : await this.target(payload.owner);
        const assignee =
          payload.assignee === undefined
            ? undefined
            : await this.target(payload.assignee);
        return {
          update: { arimms_business_owner: owner, owner_id: assignee },
          verify: (after) =>
            (owner === undefined
              ? JSON.stringify(after.businessOwner) ===
                JSON.stringify(before.businessOwner)
              : ownerOf(after) === owner) &&
            after.nativeOwnerId === (assignee ?? before.nativeOwnerId),
          changes: [
            ...(owner === undefined
              ? []
              : [
                  {
                    field: 'business_owner',
                    before: ownerOf(before),
                    after: owner,
                  },
                ]),
            ...(assignee === undefined
              ? []
              : [
                  {
                    field: 'assignee',
                    before: before.nativeOwnerId,
                    after: assignee,
                  },
                ]),
          ],
        };
      },
    );
  }

  updateInformation(
    operation: TicketActorOperation,
    ticketId: number,
    input: { title?: string; priority_id?: number },
  ) {
    const payload = { title: input.title, priority_id: input.priority_id };
    return this.change(
      operation,
      ticketId,
      'information_changed',
      payload,
      ['ticket:manage'],
      true,
      async (before) => {
        if (payload.priority_id !== undefined)
          await this.priority(payload.priority_id);
        return {
          update: payload,
          verify: (after) =>
            after.title === (payload.title ?? before.title) &&
            after.priorityId === (payload.priority_id ?? before.priorityId),
          changes: [
            ...(payload.title === undefined
              ? []
              : [
                  {
                    field: 'title',
                    before: before.title,
                    after: payload.title,
                  },
                ]),
            ...(payload.priority_id === undefined
              ? []
              : [
                  {
                    field: 'priority_id',
                    before: before.priorityId,
                    after: payload.priority_id,
                  },
                ]),
          ],
        };
      },
    );
  }

  transition(
    operation: TicketActorOperation,
    ticketId: number,
    input: { state: 'OPEN' | 'PENDING'; pending_until?: string },
  ) {
    const pending = input.pending_until;
    const minutes =
      pending === undefined
        ? undefined
        : Math.floor(Date.parse(pending) / 60_000) * 60_000;
    if (minutes !== undefined && !Number.isFinite(minutes))
      throw new TicketOperationError('INVALID');
    return this.lifecycle(
      operation,
      ticketId,
      'progressed',
      input.state,
      minutes === undefined ? undefined : new Date(minutes).toISOString(),
      undefined,
    );
  }

  close(operation: TicketActorOperation, ticketId: number, outcome: string) {
    return this.lifecycle(
      operation,
      ticketId,
      'closed',
      'CLOSED',
      undefined,
      outcome,
    );
  }

  reopen(operation: TicketActorOperation, ticketId: number, reason: string) {
    return this.lifecycle(
      operation,
      ticketId,
      'reopened',
      'OPEN',
      undefined,
      reason,
    );
  }

  private lifecycle(
    operation: TicketActorOperation,
    ticketId: number,
    action: 'closed' | 'reopened' | 'progressed',
    target: TicketState,
    pendingUntil?: string,
    reason?: string,
  ) {
    const permission =
      action === 'closed'
        ? 'ticket:close'
        : action === 'reopened'
          ? 'ticket:manage'
          : 'ticket:work';
    const payload = { target, pendingUntil, reason };
    return this.change(
      operation,
      ticketId,
      action,
      payload,
      [permission],
      false,
      async (before, actor, validOwner) => {
        const states = await this.upstream.states();
        const currentOwner =
          validOwner && ownerOf(before) === actor.mapping.zammadUserId;
        if (action === 'closed' && !currentOwner)
          throw new TicketOperationError('DENIED');
        if (
          action === 'reopened' &&
          !currentOwner &&
          actor.actor.role !== 'OPERATOR'
        )
          throw new TicketOperationError('DENIED');
        const valid =
          action === 'closed'
            ? before.stateId === states.OPEN
            : action === 'reopened'
              ? before.stateId === states.CLOSED
              : target === 'PENDING'
                ? before.stateId === states.OPEN
                : before.stateId === states.NEW ||
                  before.stateId === states.PENDING;
        if (!valid) throw new TicketOperationError('CONFLICT');
        if (
          (target === 'PENDING') !== (pendingUntil !== undefined) ||
          (pendingUntil !== undefined && Date.parse(pendingUntil) <= Date.now())
        )
          throw new TicketOperationError('INVALID');
        return {
          update: {
            state_id: states[target],
            ...(pendingUntil ? { pending_time: pendingUntil } : {}),
          },
          verify: (after) =>
            after.stateId === states[target] &&
            (!pendingUntil ||
              (!!after.pendingUntil &&
                Math.abs(
                  Date.parse(after.pendingUntil) - Date.parse(pendingUntil),
                ) < 1000)),
          changes: [
            {
              field: 'state_id',
              before: before.stateId,
              after: states[target],
            },
            ...(reason
              ? [
                  {
                    field:
                      action === 'closed' ? 'closure_outcome' : 'reopen_reason',
                    after: reason,
                  },
                ]
              : []),
          ],
        };
      },
    );
  }

  async articlePage(
    actorId: string,
    ticketId: number,
    after: number,
    limit: number,
  ) {
    await this.resource(actorId, ticketId);
    const articles = (await this.upstream.articles(ticketId)).filter(
      (article) =>
        article.id > after && (article.type === 'note' || !article.internal),
    );
    await this.resource(actorId, ticketId);
    return {
      articles: articles.slice(0, limit),
      next: articles.length > limit ? articles[limit - 1].id : null,
    };
  }

  async appendArticle(
    operation: TicketActorOperation,
    ticketId: number,
    body: string,
  ) {
    await this.actor(operation.actor, ['ticket:work']);
    const initial = await this.resource(operation.actor, ticketId);
    const finishArticle = async (
      ticket: ExternalTicket,
      marker: string,
      id?: number,
    ): Promise<JournalResult> => {
      const articleId = await this.verifyArticle(ticketId, marker, body, id);
      return {
        ticketId,
        articleId,
        notification: notificationFor('article_added', ticket),
        changes: [{ field: 'article_id', after: articleId }],
      };
    };
    const result = await this.journal.run(
      this.intent(operation, 'article_added', { body }, ticketId),
      async () => {
        await this.actor(operation.actor, ['ticket:work']);
        const { ticket } = await this.resource(operation.actor, ticketId);
        return async (marker) => {
          const articleId = await this.upstream.append(ticketId, body, marker);
          return finishArticle(ticket, marker, articleId);
        };
      },
      (marker) => finishArticle(initial.ticket, marker),
    );
    await this.resource(operation.actor, ticketId);
    return result;
  }

  async getLinks(actor: string, ticketId: number) {
    await this.resource(actor, ticketId);
    const links =
      (await this.store.links(
        this.scope.instanceKey,
        this.scope.approvedGroupId,
        ticketId,
      )) ?? emptyLinks;
    const canReadAssets = await this.iam.hasAllPermissions(actor, [
      'asset:read',
    ]);
    const assetIds = canReadAssets
      ? (
          await Promise.all(
            links.assetIds.map(async (id) =>
              (await this.assets.getAsset(id as AssetId)) ? id : null,
            ),
          )
        ).filter((id): id is string => id !== null)
      : [];
    await this.resource(actor, ticketId);
    const incidentId =
      links.incidentId &&
      this.integrations &&
      (await this.integrations.confirmedIncident(actor, links.incidentId))
        ? links.incidentId
        : null;
    const maintenanceIds = this.integrations
      ? (
          await Promise.all(
            links.maintenanceIds.map(async (id) =>
              (await this.integrations?.maintenanceActivity(
                actor,
                id,
                ticketId,
              ))
                ? id
                : null,
            ),
          )
        ).filter((id): id is string => id !== null)
      : [];
    return { assetIds, incidentId, maintenanceIds };
  }

  async setLinks(
    operation: TicketActorOperation,
    ticketId: number,
    links: {
      incidentId?: string | null;
      assetIds?: readonly string[];
    },
  ) {
    await this.actor(operation.actor, ['ticket:manage'], true);
    await this.resource(operation.actor, ticketId);
    const payload = {
      incidentId: links.incidentId,
      assetIds: links.assetIds ? [...links.assetIds].sort() : undefined,
    };
    await this.journal.run(
      this.intent(operation, 'links_changed', payload, ticketId),
      async () => {
        const before =
          (await this.store.links(
            this.scope.instanceKey,
            this.scope.approvedGroupId,
            ticketId,
          )) ?? emptyLinks;
        const after = {
          incidentId:
            payload.incidentId === undefined
              ? before.incidentId
              : payload.incidentId,
          assetIds: payload.assetIds ?? before.assetIds,
          maintenanceIds: before.maintenanceIds,
        };
        await this.validateLinks(
          operation.actor,
          after,
          payload.incidentId !== undefined,
          payload.assetIds !== undefined,
        );
        await this.actor(operation.actor, ['ticket:manage'], true);
        await this.resource(operation.actor, ticketId);
        return () =>
          Promise.resolve({
            ticketId,
            links: after,
            changes: this.linkAudit(before, after),
          });
      },
    );
    return this.getLinks(operation.actor, ticketId);
  }

  /** Future Maintenance workflow callers must supply an owning-module contract. */
  async linkMaintenanceActivity(
    operation: TicketActorOperation,
    ticketId: number,
    activityId: string,
  ) {
    await this.actor(operation.actor, ['ticket:manage'], true);
    await this.resource(operation.actor, ticketId);
    const integrations = this.integrations;
    if (!integrations) throw new TicketOperationError('UNAVAILABLE');
    await this.journal.run(
      this.intent(operation, 'maintenance_linked', { activityId }, ticketId),
      async () => {
        if (
          !(await integrations.maintenanceActivity(
            operation.actor,
            activityId,
            ticketId,
          ))
        )
          throw new TicketOperationError('INVALID');
        const before =
          (await this.store.links(
            this.scope.instanceKey,
            this.scope.approvedGroupId,
            ticketId,
          )) ?? emptyLinks;
        const maintenanceIds = [
          ...new Set([...before.maintenanceIds, activityId]),
        ].sort();
        if (maintenanceIds.length > 20)
          throw new TicketOperationError('INVALID');
        await this.actor(operation.actor, ['ticket:manage'], true);
        await this.resource(operation.actor, ticketId);
        return () =>
          Promise.resolve({
            ticketId,
            links: { ...before, maintenanceIds },
            changes: [
              {
                field: 'maintenance_activity_ids',
                before: JSON.stringify(before.maintenanceIds),
                after: JSON.stringify(maintenanceIds),
              },
            ],
          });
      },
    );
    return this.getLinks(operation.actor, ticketId);
  }

  private async change(
    operation: TicketActorOperation,
    ticketId: number,
    action: TicketNotificationKind,
    payload: object,
    permissions: readonly PermissionCode[],
    operatorOnly: boolean,
    prepare: (
      before: ExternalTicket,
      principal: Awaited<ReturnType<TicketWorkflow['actor']>>,
      validOwner: boolean,
    ) => Promise<{
      update: TicketChanges;
      verify: (after: ExternalTicket) => boolean;
      changes: JournalResult['changes'];
    }>,
  ) {
    await this.actor(operation.actor, permissions, operatorOnly);
    await this.resource(operation.actor, ticketId);
    await this.journal.run(
      this.intent(operation, action, payload, ticketId),
      async () => {
        const principal = await this.actor(
          operation.actor,
          permissions,
          operatorOnly,
        );
        const initial = await this.resource(operation.actor, ticketId);
        const prepared = await prepare(
          initial.ticket,
          principal,
          initial.businessOwnerStatus === 'valid',
        );
        const latestActor = await this.actor(
          operation.actor,
          permissions,
          operatorOnly,
        );
        const latest = await this.resource(operation.actor, ticketId);
        if (
          latestActor.actor.role !== principal.actor.role ||
          latestActor.mapping.zammadUserId !== principal.mapping.zammadUserId ||
          latest.businessOwnerStatus !== initial.businessOwnerStatus ||
          JSON.stringify(latest.ticket) !== JSON.stringify(initial.ticket)
        )
          throw new TicketOperationError('CONFLICT');

        return async () => {
          await this.upstream.update(ticketId, prepared.update);
          const after = await this.readback(ticketId);
          if (
            !prepared.verify(after) ||
            (prepared.update.state_id === undefined &&
              after.stateId !== latest.ticket.stateId) ||
            (prepared.update.owner_id === undefined &&
              after.nativeOwnerId !== latest.ticket.nativeOwnerId) ||
            (prepared.update.arimms_business_owner === undefined &&
              JSON.stringify(after.businessOwner) !==
                JSON.stringify(latest.ticket.businessOwner))
          )
            throw new TicketOperationError('UNRESOLVED');
          return {
            ticketId,
            changes: prepared.changes,
            ...(prepared.changes.some(
              (change) => change.before !== change.after,
            )
              ? { notification: notificationFor(action, after) }
              : {}),
          };
        };
      },
    );
    return (await this.resource(operation.actor, ticketId)).ticket;
  }

  private async actor(
    id: string,
    permissions: readonly PermissionCode[] = [],
    operatorOnly = false,
  ) {
    const result = await this.authorization.authorizeActor(id);
    if (
      !result ||
      (operatorOnly && result.actor.role !== 'OPERATOR') ||
      (permissions.length &&
        !(await this.iam.hasAllPermissions(id, permissions)))
    )
      throw new TicketOperationError('DENIED');
    return result;
  }

  private async resource(actor: string, ticketId: number) {
    const result = await this.authorization.execute(actor, ticketId);
    if (result.status !== 'allowed')
      throw new TicketOperationError('NOT_FOUND');
    return result;
  }

  private async optionalTarget(id: string) {
    return (
      (await this.authorization.authorizeActor(id))?.mapping.zammadUserId ??
      null
    );
  }

  private async target(id: string) {
    const result = await this.optionalTarget(id);
    if (!result) throw new TicketOperationError('INVALID');
    return result;
  }

  private async priority(id: number) {
    if (!(await this.upstream.priorityAvailable(id)))
      throw new TicketOperationError('INVALID');
  }

  private async readback(id: number) {
    const ticket = await this.tickets.getTicket(id);
    if (
      !ticket ||
      ticket.externalTicketId !== id ||
      ticket.groupId !== this.scope.approvedGroupId
    )
      throw new TicketOperationError('UNRESOLVED');
    return ticket;
  }

  private async verifyArticle(
    ticketId: number,
    marker: string,
    body: string,
    articleId?: number,
  ) {
    const matching = (await this.upstream.articles(ticketId)).filter(
      (article) =>
        article.subject === `AR-IMMS operation ${marker}` &&
        article.internal &&
        article.type === 'note' &&
        article.createdBy === this.serviceUserId &&
        article.text === body,
    );
    if (matching.length !== 1) throw new TicketOperationError('UNRESOLVED');
    if (articleId !== undefined && matching[0].id !== articleId)
      throw new TicketOperationError('UNRESOLVED');
    return matching[0].id;
  }

  private async validateLinks(
    actor: string,
    links: TicketLinks,
    validateIncident = true,
    validateAssets = true,
  ) {
    if (validateIncident && links.incidentId && !this.integrations)
      throw new TicketOperationError('UNAVAILABLE');
    if (
      validateIncident &&
      links.incidentId &&
      !(await this.integrations?.confirmedIncident(actor, links.incidentId))
    )
      throw new TicketOperationError('INVALID');
    if (!validateAssets || !links.assetIds.length) return;
    if (!(await this.iam.hasAllPermissions(actor, ['asset:read'])))
      throw new TicketOperationError('DENIED');
    for (const id of links.assetIds) {
      const asset = await this.assets.getAsset(id as AssetId);
      if (!asset || asset.lifecycleState === 'RETIRED')
        throw new TicketOperationError('INVALID');
    }
  }

  private linkAudit(before: TicketLinks, after: TicketLinks) {
    return [
      {
        field: 'incident_id',
        before: before.incidentId,
        after: after.incidentId,
      },
      {
        field: 'asset_ids',
        before: JSON.stringify(before.assetIds),
        after: JSON.stringify(after.assetIds),
      },
    ];
  }

  private intent(
    operation: TicketActorOperation,
    action: string,
    payload: object,
    ticketId?: number,
  ) {
    return {
      ...operation,
      action,
      payload,
      ticketId,
      instance: this.scope.instanceKey,
      group: this.scope.approvedGroupId,
    };
  }
}

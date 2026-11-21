import { z } from 'zod';
import { TicketReadError } from '../application/ticket-read.port';
import type {
  NewExternalTicket,
  SearchExternalTickets,
  TicketChanges,
  TicketUpstreamPort,
} from '../application/ticket-upstream.port';
import {
  parseZammadReadConfig,
  type ZammadReadConfig,
} from './zammad-read.config';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reference = z.object({ id });
const state = z.object({
  id,
  name: z.string(),
  active: z.boolean(),
  next_state_id: id.nullable(),
});
const article = z.object({
  id,
  ticket_id: id,
  internal: z.boolean(),
  type: z.string().min(1),
  content_type: z.string(),
  body: z.string().nullable(),
  subject: z.string().nullable(),
  created_by_id: id,
  created_at: z.iso.datetime({ offset: true }),
});

export class ZammadTicketWorkflowAdapter implements TicketUpstreamPort {
  readonly #config: ZammadReadConfig;

  constructor(
    config: ZammadReadConfig,
    private readonly customerId: number,
  ) {
    this.#config = parseZammadReadConfig(config);
    if (!id.safeParse(customerId).success)
      throw new Error('Invalid configured Ticket customer');
  }

  async create(ticket: NewExternalTicket) {
    const result = await this.request('tickets', reference, 'POST', {
      title: ticket.title,
      group_id: this.#config.expectedGroupId,
      customer_id: this.customerId,
      owner_id: ticket.assigneeId,
      arimms_business_owner: ticket.ownerId,
      state_id: ticket.stateId,
      priority_id: ticket.priorityId,
      article: this.note(ticket.body, ticket.marker),
    });
    return result.id;
  }

  async update(ticketId: number, changes: TicketChanges) {
    const result = await this.request(
      `tickets/${ticketId}`,
      reference,
      'PUT',
      changes,
    );
    if (result.id !== ticketId)
      throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
  }

  async append(ticketId: number, body: string, marker: string) {
    const result = await this.request(
      'ticket_articles',
      reference.extend({ ticket_id: id }),
      'POST',
      {
        ticket_id: ticketId,
        ...this.note(body, marker),
      },
    );
    if (result.ticket_id !== ticketId)
      throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
    return result.id;
  }

  async articles(ticketId: number) {
    const rows = await this.request(
      `ticket_articles/by_ticket/${ticketId}`,
      z.array(article).max(2_000),
    );
    const seen = new Set<number>();
    return rows
      .map((record) => {
        if (record.ticket_id !== ticketId || seen.has(record.id))
          throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
        seen.add(record.id);
        return {
          id: record.id,
          ticketId,
          createdAt: record.created_at,
          internal: record.internal,
          type: record.type,
          text: record.content_type === 'text/plain' ? record.body : null,
          subject: record.subject,
          createdBy: record.created_by_id,
        };
      })
      .sort((a, b) => a.id - b.id);
  }

  async search(input: SearchExternalTickets) {
    const clauses = [
      `group_id:${this.#config.expectedGroupId}`,
      `id:>${input.after}`,
    ];
    if (input.ownerId) clauses.push(`arimms_business_owner:${input.ownerId}`);
    if (input.assigneeId) clauses.push(`owner_id:${input.assigneeId}`);
    if (input.stateId) clauses.push(`state_id:${input.stateId}`);
    if (input.priorityId) clauses.push(`priority_id:${input.priorityId}`);
    if (input.visibleTo)
      clauses.push(
        `(owner_id:${input.visibleTo} OR arimms_business_owner:${input.visibleTo})`,
      );
    if (input.search) {
      if (!/^[\p{L}\p{N} ]{1,80}$/u.test(input.search))
        throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
      clauses.push(`title:"${input.search}"`);
    }
    const query = new URLSearchParams({
      query: clauses.join(' AND '),
      sort_by: 'id',
      order_by: 'asc',
      limit: String(input.limit),
    });
    const rows = await this.request(
      `tickets/search?${query}`,
      z.array(reference).max(input.limit),
    );
    const ids = rows.map(({ id }) => id);
    if (ids.some((value, index) => value <= (ids[index - 1] ?? input.after)))
      throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
    return ids;
  }

  async states() {
    const rows = await this.request('ticket_states', z.array(state));
    function resolve(name: string) {
      const matching = rows.filter(
        (row) => row.name === name && row.active && row.next_state_id === null,
      );
      if (matching.length !== 1)
        throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
      return matching[0].id;
    }
    const result = {
      NEW: resolve('new'),
      OPEN: resolve('open'),
      PENDING: resolve('pending reminder'),
      CLOSED: resolve('closed'),
    };
    if (new Set(Object.values(result)).size !== 4)
      throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
    return result;
  }

  async priorityAvailable(priorityId: number) {
    const result = await this.request(
      'ticket_priorities',
      z.array(reference.extend({ active: z.boolean() })),
    );
    return (
      result.filter((row) => row.id === priorityId && row.active).length === 1
    );
  }

  private note(body: string, marker: string) {
    return {
      subject: `AR-IMMS operation ${marker}`,
      body,
      type: 'note',
      sender: 'Agent',
      content_type: 'text/plain',
      internal: true,
    };
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    method = 'GET',
    body?: object,
  ): Promise<T> {
    try {
      const response = await fetch(`${this.#config.baseUrl}/api/v1/${path}`, {
        method,
        headers: {
          Authorization: `Token token=${this.#config.apiToken}`,
          Accept: 'application/json',
          ...(body
            ? {
                'Content-Type': 'application/json',
                'X-Zammad-Suppress-Notifications': 'true',
              }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.#config.timeoutMs),
        redirect: 'error',
      });
      if (response.status !== (method === 'POST' ? 201 : 200)) {
        await response.body?.cancel();
        throw new TicketReadError('UPSTREAM_UNAVAILABLE');
      }
      if (
        response.headers.get('content-type')?.split(';')[0].trim() !==
        'application/json'
      ) {
        await response.body?.cancel();
        throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
      }
      const result = schema.safeParse(await response.json());
      if (!result.success)
        throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
      return result.data;
    } catch (error) {
      if (error instanceof TicketReadError) throw error;
      throw new TicketReadError('UPSTREAM_UNAVAILABLE');
    }
  }
}

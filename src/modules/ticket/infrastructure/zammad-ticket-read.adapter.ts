import z from 'zod';
import { ZammadReadClient } from './zammad-read.client';

import {
  TicketReadError,
  type ExternalTicket,
  type TicketReadPort,
} from '../application/ticket-read.port';
import {
  parseZammadReadConfig,
  type ZammadReadConfig,
} from './zammad-read.config';

const externalId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
// Validate every returned field without coercion; discard unselected fields.
const ticketSchema = z.object({
  id: externalId,
  number: z.string().min(1),
  title: z.string().min(1),
  group_id: externalId,
  owner_id: externalId,
  arimms_business_owner: z.unknown().optional(),
  customer_id: externalId,
  state_id: externalId,
  priority_id: externalId,
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  pending_time: z.iso.datetime({ offset: true }).nullish(),
});

/** Single-instance GET adapter; no retries, redirects, persistence or IAM policy. */
export class ZammadTicketReadAdapter implements TicketReadPort {
  readonly #config: ZammadReadConfig;

  constructor(config: ZammadReadConfig) {
    this.#config = parseZammadReadConfig(config);
  }

  async getTicket(id: number): Promise<ExternalTicket | null> {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new TicketReadError('INVALID_TICKET_ID');
    }

    const body = await new ZammadReadClient(this.#config).get(`tickets/${id}`);
    if (body === null) return null;
    const parsed = ticketSchema.safeParse(body);
    if (!parsed.success || parsed.data.id !== id) {
      throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
    }
    const ticket = parsed.data;
    if (ticket.group_id !== this.#config.expectedGroupId) return null;

    return {
      externalTicketId: ticket.id,
      number: ticket.number,
      title: ticket.title,
      groupId: ticket.group_id,
      nativeOwnerId: ticket.owner_id,
      businessOwner:
        ticket.arimms_business_owner == null
          ? { kind: 'missing' }
          : typeof ticket.arimms_business_owner === 'number' &&
              Number.isInteger(ticket.arimms_business_owner) &&
              ticket.arimms_business_owner > 0 &&
              ticket.arimms_business_owner <= 2147483647
            ? {
                kind: 'reference',
                externalUserId: ticket.arimms_business_owner,
              }
            : { kind: 'invalid' },
      customerId: ticket.customer_id,
      stateId: ticket.state_id,
      priorityId: ticket.priority_id,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      ...(ticket.pending_time ? { pendingUntil: ticket.pending_time } : {}),
    };
  }
}

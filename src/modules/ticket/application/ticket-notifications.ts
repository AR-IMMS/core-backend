import type { MappingScope } from '../domain/identity-mapping';
import type { GetAuthorizedTicket } from './get-authorized-ticket';
import { TicketOperationError } from './ticket-journal';
import type { ExternalTicket } from './ticket-read.port';

export const ticketNotificationKinds = [
  'created',
  'responsibilities_changed',
  'information_changed',
  'progressed',
  'closed',
  'reopened',
  'article_added',
  'evidence_added',
] as const;

export type TicketNotificationKind = (typeof ticketNotificationKinds)[number];
export const ticketNotificationLimit = 20;

export function notificationFor(
  kind: TicketNotificationKind,
  ticket?: ExternalTicket,
) {
  if (!ticket) return undefined;
  const recipients = new Set<number>();
  if (ticket.nativeOwnerId > 0) recipients.add(ticket.nativeOwnerId);
  if (ticket.businessOwner.kind === 'reference')
    recipients.add(ticket.businessOwner.externalUserId);
  return { kind, recipients: [...recipients] };
}

export interface TicketNotificationAudience {
  readonly instance: string;
  readonly group: number;
  readonly externalUserId: number;
  readonly actor: string;
}

export interface TicketNotificationCandidate {
  readonly id: string;
  readonly ticketId: number;
  readonly kind: TicketNotificationKind;
  readonly occurredAt: string;
  readonly read: boolean;
}

export interface TicketNotificationStore {
  notificationCandidates(
    audience: TicketNotificationAudience,
    limit: number,
    ids?: readonly string[],
  ): Promise<TicketNotificationCandidate[]>;
  markNotificationsRead(
    audience: TicketNotificationAudience,
    ids: readonly string[],
  ): Promise<number>;
}

export class TicketNotifications {
  constructor(
    private readonly access: Pick<
      GetAuthorizedTicket,
      'authorizeActor' | 'execute'
    >,
    private readonly store: TicketNotificationStore,
    private readonly scope: MappingScope,
  ) {}

  async list(actor: string) {
    const audience = await this.audience(actor);
    const items = await this.visible(audience);
    return { items, unread_count: items.filter((row) => !row.read).length };
  }

  async markRead(actor: string, ids: readonly string[]) {
    const audience = await this.audience(actor);
    const visible = await this.visible(audience, ids);
    if (visible.length !== ids.length)
      throw new TicketOperationError('NOT_FOUND');
    return {
      updated_count: await this.store.markNotificationsRead(audience, ids),
    };
  }

  private async audience(actor: string): Promise<TicketNotificationAudience> {
    const principal = await this.access.authorizeActor(actor);
    if (!principal) throw new TicketOperationError('DENIED');

    return {
      instance: this.scope.instanceKey,
      group: this.scope.approvedGroupId,
      externalUserId: principal.mapping.zammadUserId,
      actor,
    };
  }

  private async visible(
    audience: TicketNotificationAudience,
    ids?: readonly string[],
  ) {
    const rows = await this.store.notificationCandidates(
      audience,
      ticketNotificationLimit,
      ids,
    );
    const ticketIds = [...new Set(rows.map((row) => row.ticketId))];
    const tickets = new Map<number, ExternalTicket>();
    for (let start = 0; start < ticketIds.length; start += 4) {
      await Promise.all(
        ticketIds.slice(start, start + 4).map(async (id) => {
          const result = await this.access.execute(audience.actor, id);
          if (result.status === 'allowed') tickets.set(id, result.ticket);
        }),
      );
    }
    return rows.flatMap((row) => {
      const ticket = tickets.get(row.ticketId);
      if (!ticket) return [];
      return [
        {
          id: row.id,
          kind: row.kind,
          ticket_id: row.ticketId,
          ticket_number: ticket.number,
          ticket_title: ticket.title,
          occurred_at: row.occurredAt,
          read: row.read,
        },
      ];
    });
  }
}

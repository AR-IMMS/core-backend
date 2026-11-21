export type TicketState = 'NEW' | 'OPEN' | 'PENDING' | 'CLOSED';

export interface NewExternalTicket {
  readonly title: string;
  readonly priorityId: number;
  readonly stateId: number;
  readonly ownerId: number;
  readonly assigneeId: number;
  readonly body: string;
  readonly marker: string;
}

export interface TicketChanges {
  readonly title?: string;
  readonly priority_id?: number;
  readonly arimms_business_owner?: number;
  readonly owner_id?: number;
  readonly state_id?: number;
  readonly pending_time?: string;
}

export interface TicketArticle {
  readonly id: number;
  readonly ticketId: number;
  readonly createdAt: string;
  readonly internal: boolean;
  readonly type: string;
  readonly text: string | null;
  readonly subject: string | null;
  readonly createdBy: number;
}

export interface SearchExternalTickets {
  readonly after: number;
  readonly limit: number;
  readonly stateId?: number;
  readonly priorityId?: number;
  readonly ownerId?: number;
  readonly assigneeId?: number;
  readonly visibleTo?: number;
  readonly search?: string;
}

export interface TicketUpstreamPort {
  create(ticket: NewExternalTicket): Promise<number>;
  update(ticketId: number, changes: TicketChanges): Promise<void>;
  append(ticketId: number, body: string, marker: string): Promise<number>;
  articles(ticketId: number): Promise<readonly TicketArticle[]>;
  search(query: SearchExternalTickets): Promise<readonly number[]>;
  states(): Promise<Readonly<Record<TicketState, number>>>;
  priorityAvailable(priorityId: number): Promise<boolean>;
}

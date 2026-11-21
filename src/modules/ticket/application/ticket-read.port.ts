export type BusinessOwnerReference =
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'reference'; readonly externalUserId: number };

/** A validated read from one configured Zammad instance, never a local Ticket. */
export interface ExternalTicket {
  readonly externalTicketId: number;
  readonly number: string;
  readonly title: string;
  readonly groupId: number;
  /** Native Zammad assignment only; not the AR-IMMS Business Owner. */
  readonly nativeOwnerId: number;
  readonly businessOwner: BusinessOwnerReference;
  readonly customerId: number;
  readonly stateId: number;
  readonly priorityId: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pendingUntil?: string;
}

/** Internal outbound port. Does not authorize a Core user to see a Ticket. */
export interface TicketReadPort {
  /** Returns null for missing or out-of-group Tickets. */
  getTicket(id: number): Promise<ExternalTicket | null>;
}

export const TICKET_READ_PORT = Symbol('TICKET_READ_PORT');

export type TicketReadErrorCode =
  | 'INVALID_TICKET_ID'
  | 'UPSTREAM_ACCESS_DENIED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'INVALID_UPSTREAM_RESPONSE'
  | 'UNEXPECTED_UPSTREAM_STATUS';

/** Contains no upstream body, URL, headers, credential or original exception. */
export class TicketReadError extends Error {
  constructor(readonly code: TicketReadErrorCode) {
    super(`Ticket read failed: ${code}`);
    this.name = 'TicketReadError';
  }
}

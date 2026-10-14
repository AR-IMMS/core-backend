import type { AuditRecord } from './audit-record';

/** Filters supported by the Audit event list endpoint. */
export interface AuditEventFilters {
  readonly occurredFrom?: Date;
  readonly occurredTo?: Date;
  readonly actorId?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly requestId?: string;
}

/** A durable Audit record with its database recording time for read responses. */
export interface AuditRecordView extends AuditRecord {
  readonly recordedAt: Date;
}

/** One cursor-paginated Audit event query. */
export interface AuditEventListQuery {
  readonly filters: AuditEventFilters;
  readonly pageSize: number;
  readonly cursor?: AuditEventCursor;
}

/** Cursor position immediately after the last record returned on a page. */
export interface AuditEventCursor {
  readonly occurredAt: Date;
  readonly eventId: string;
}

/** A page of durable Audit records and an opaque continuation cursor. */
export interface AuditEventPage {
  readonly items: readonly AuditRecordView[];
  readonly nextCursor: AuditEventCursor | null;
}

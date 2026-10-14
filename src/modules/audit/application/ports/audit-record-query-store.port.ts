import type {
  AuditEventListQuery,
  AuditEventPage,
  AuditRecordView,
} from '../../domain/audit-query';

/** Read-only query contract for durable Audit records. */
export interface AuditRecordQueryStorePort {
  list(query: AuditEventListQuery): Promise<AuditEventPage>;
  getByEventId(eventId: string): Promise<AuditRecordView | null>;
}

import type { AuditRecordQueryStorePort } from './ports/audit-record-query-store.port';
import type {
  AuditEventListQuery,
  AuditEventPage,
} from '../domain/audit-query';

/** Lists append-only Audit records using strict filters and an opaque cursor. */
export class ListAuditEventsUseCase {
  constructor(private readonly auditRecords: AuditRecordQueryStorePort) {}

  execute(query: AuditEventListQuery): Promise<AuditEventPage> {
    return this.auditRecords.list(query);
  }
}

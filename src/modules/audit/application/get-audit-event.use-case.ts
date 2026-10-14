import type { AuditRecordQueryStorePort } from './ports/audit-record-query-store.port';
import type { AuditRecordView } from '../domain/audit-query';

/** Retrieves an append-only Audit record by its stable event ID. */
export class GetAuditEventUseCase {
  constructor(private readonly auditRecords: AuditRecordQueryStorePort) {}

  execute(eventId: string): Promise<AuditRecordView | null> {
    return this.auditRecords.getByEventId(eventId);
  }
}

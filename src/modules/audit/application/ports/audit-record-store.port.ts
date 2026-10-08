import type { AuditRecord } from '../../domain/audit-record';

export type AuditAppendResult = 'inserted' | 'duplicate';

/** Appends one immutable Audit record, deduplicating by Audit Fact ID. */
export interface AuditRecordStorePort {
  appendIfAbsent(record: AuditRecord): Promise<AuditAppendResult>;
}

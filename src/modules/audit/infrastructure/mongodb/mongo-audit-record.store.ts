import type { AuditRecordStorePort } from '../../application/ports/audit-record-store.port';
import type { AuditRecord } from '../../domain/audit-record';

/** Narrow append-only model surface provided by Mongoose injection. */
export interface MongoAuditRecordModel {
  create(records: readonly AuditRecord[]): Promise<unknown>;
}

/** Mongo persistence adapter with event-ID uniqueness as the idempotency guard. */
export class MongoAuditRecordStore implements AuditRecordStorePort {
  constructor(private readonly auditModel: MongoAuditRecordModel) {}

  async appendIfAbsent(record: AuditRecord): Promise<'inserted' | 'duplicate'> {
    try {
      await this.auditModel.create([record]);
      return 'inserted';
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        return 'duplicate';
      }
      throw error;
    }
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }
}

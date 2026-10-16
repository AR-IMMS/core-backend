import type { AuditRecordStorePort } from '../../application/ports/audit-record-store.port';
import type { AuditRecordQueryStorePort } from '../../application/ports/audit-record-query-store.port';
import type { AuditRecord } from '../../domain/audit-record';
import type {
  AuditEventListQuery,
  AuditEventPage,
  AuditRecordView,
} from '../../domain/audit-query';

interface MongoAuditRecordDocument extends AuditRecord {
  readonly createdAt: Date;
}

interface MongoAuditRecordListQuery {
  sort(sort: { occurredAt: -1; eventId: -1 }): MongoAuditRecordListQuery;
  limit(amount: number): MongoAuditRecordListQuery;
  lean(): { exec(): Promise<readonly MongoAuditRecordDocument[]> };
}

interface MongoAuditRecordSingleQuery {
  lean(): { exec(): Promise<MongoAuditRecordDocument | null> };
}

/** Narrow append-only model surface provided by Mongoose injection. */
export interface MongoAuditRecordModel {
  create(records: readonly AuditRecord[]): Promise<unknown>;
  find(filter: Record<string, unknown>): MongoAuditRecordListQuery;
  findOne(filter: Record<string, unknown>): MongoAuditRecordSingleQuery;
}

/** Mongo persistence adapter with event-ID uniqueness as the idempotency guard. */
export class MongoAuditRecordStore
  implements AuditRecordStorePort, AuditRecordQueryStorePort
{
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

  async list(query: AuditEventListQuery): Promise<AuditEventPage> {
    const documents = await this.auditModel
      .find(buildAuditRecordFilter(query))
      .sort({ occurredAt: -1, eventId: -1 })
      .limit(query.pageSize + 1)
      .lean()
      .exec();
    const hasMore = documents.length > query.pageSize;
    const items = documents.slice(0, query.pageSize).map(toAuditRecordView);
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last
          ? { occurredAt: last.occurredAt, eventId: last.eventId }
          : null,
    };
  }

  async getByEventId(eventId: string): Promise<AuditRecordView | null> {
    const document = await this.auditModel.findOne({ eventId }).lean().exec();
    return document ? toAuditRecordView(document) : null;
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

function buildAuditRecordFilter(
  query: AuditEventListQuery,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const occurredAt: { $gte?: Date; $lte?: Date } = {};
  if (query.filters.occurredFrom) {
    occurredAt.$gte = query.filters.occurredFrom;
  }
  if (query.filters.occurredTo) {
    occurredAt.$lte = query.filters.occurredTo;
  }
  if (Object.keys(occurredAt).length > 0) filter['occurredAt'] = occurredAt;
  if (query.filters.actorId) filter['actor.id'] = query.filters.actorId;
  if (query.filters.action) filter['action'] = query.filters.action;
  if (query.filters.resourceType) {
    filter['resource.type'] = query.filters.resourceType;
  }
  if (query.filters.resourceId)
    filter['resource.id'] = query.filters.resourceId;
  if (query.filters.requestId) {
    filter['context.request_id'] = query.filters.requestId;
  }
  if (query.cursor) {
    filter.$or = [
      { occurredAt: { $lt: query.cursor.occurredAt } },
      {
        occurredAt: query.cursor.occurredAt,
        eventId: { $lt: query.cursor.eventId },
      },
    ];
  }
  return filter;
}

function toAuditRecordView(
  document: MongoAuditRecordDocument,
): AuditRecordView {
  return {
    eventId: document.eventId,
    eventType: document.eventType,
    eventVersion: document.eventVersion,
    producer: document.producer,
    actor: document.actor,
    action: document.action,
    resource: document.resource,
    occurredAt: document.occurredAt,
    recordedAt: document.createdAt,
    context: document.context,
    changes: document.changes,
  };
}

import type { ClientSession, Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import {
  TicketOperationError,
  type JournalResult,
  type TicketJournalStore,
  type TicketLinks,
  type TicketReceipt,
  type TicketArchiveRecord,
  type TicketEvidenceRecord,
} from '../../application/ticket-journal';

import type {
  TicketNotificationAudience,
  TicketNotificationCandidate,
  TicketNotificationStore,
} from '../../application/ticket-notifications';

interface BusinessContext extends TicketLinks {
  readonly instance: string;
  readonly group: number;
  readonly ticketId: number;
  readonly createdBy?: string;
  readonly auditSequence?: number;
}

export class MongoTicketJournalStore
  implements TicketJournalStore, TicketNotificationStore
{
  private readonly receipts;
  private readonly contexts;
  private readonly archives;
  private readonly evidence;

  constructor(connection: Connection) {
    const db = connection.getClient().db(connection.name);
    this.receipts = db.collection<TicketReceipt>('ticket_operation_receipts');
    this.contexts = db.collection<BusinessContext>('ticket_business_contexts');
    this.archives = db.collection<TicketArchiveRecord>('ticket_archives');
    this.evidence = db.collection<TicketEvidenceRecord>('ticket_evidence');
  }

  async initialize() {
    await this.archives.createIndex(
      { instance: 1, group: 1, ticketId: 1 },
      { unique: true },
    );
    await this.archives.createIndex({
      instance: 1,
      group: 1,
      active: 1,
      ticketId: 1,
    });
    await this.evidence.createIndex(
      { instance: 1, group: 1, ticketId: 1, id: 1 },
      { unique: true },
    );
    await this.evidence.createIndex(
      { instance: 1, group: 1, ticketId: 1, sha256: 1 },
      { unique: true },
    );
    await this.receipts.createIndex({ id: 1 }, { unique: true });
    await this.receipts.createIndex(
      {
        instance: 1,
        group: 1,
        'result.notification.recipients': 1,
        occurredAt: -1,
        eventId: -1,
      },
      {
        name: 'ix_ticket_notification_inbox',
        partialFilterExpression: {
          stage: 'succeeded',
          'result.notification.recipients': { $exists: true },
        },
      },
    );
    await this.receipts.createIndex(
      { lock: 1 },
      { unique: true, sparse: true },
    );
    await this.contexts.createIndex(
      { instance: 1, group: 1, ticketId: 1 },
      { unique: true },
    );
  }

  private notificationFilter(audience: TicketNotificationAudience) {
    return {
      instance: audience.instance,
      group: audience.group,
      stage: 'succeeded' as const,
      actor: { $ne: audience.actor },
      'result.notification.recipients': audience.externalUserId,
    };
  }

  async notificationCandidates(
    audience: TicketNotificationAudience,
    limit: number,
    ids?: readonly string[],
  ): Promise<TicketNotificationCandidate[]> {
    const rows = await this.receipts
      .find(
        {
          ...this.notificationFilter(audience),
          ...(ids ? { eventId: { $in: [...ids] } } : {}),
        },
        {
          projection: {
            _id: 0,
            eventId: 1,
            occurredAt: 1,
            notificationReadBy: 1,
            'result.ticketId': 1,
            'result.notification.kind': 1,
          },
        },
      )
      .sort({ occurredAt: -1, eventId: -1 })
      .limit(limit)
      .toArray();
    return rows.flatMap((row) =>
      row.result?.notification
        ? [
            {
              id: row.eventId,
              ticketId: row.result.ticketId,
              kind: row.result.notification.kind,
              occurredAt: row.occurredAt,
              read: row.notificationReadBy?.includes(audience.actor) ?? false,
            },
          ]
        : [],
    );
  }

  async markNotificationsRead(
    audience: TicketNotificationAudience,
    ids: readonly string[],
  ) {
    const result = await this.receipts.updateMany(
      { ...this.notificationFilter(audience), eventId: { $in: [...ids] } },
      { $addToSet: { notificationReadBy: audience.actor } },
    );
    return result.modifiedCount;
  }

  async claim(receipt: TicketReceipt) {
    try {
      await this.receipts.insertOne(receipt);
      return null;
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 11000
      )
        throw error;
      const existing = await this.receipts.findOne({ id: receipt.id });
      if (!existing) throw new TicketOperationError('CONFLICT');
      return existing;
    }
  }

  find(id: string) {
    return this.receipts.findOne({ id });
  }

  async verify(id: string, result: JournalResult) {
    const update = await this.receipts.updateOne(
      { id, stage: 'dispatching' },
      { $set: { result, stage: 'verified' } },
    );
    if (!update.modifiedCount) throw new TicketOperationError('UNRESOLVED');
  }

  async fail(id: string) {
    await this.receipts.updateOne(
      { id, stage: 'dispatching' },
      { $set: { stage: 'failed' }, $unset: { lock: '' } },
    );
  }

  async complete(id: string, context: UnitOfWorkContext) {
    const result = await this.receipts.updateOne(
      { id, stage: 'verified' },
      { $set: { stage: 'succeeded' }, $unset: { lock: '' } },
      { session: this.session(context) },
    );
    if (result.modifiedCount) return true;
    if (
      await this.receipts.findOne(
        { id, stage: 'succeeded' },
        { session: this.session(context) },
      )
    )
      return false;
    throw new TicketOperationError('UNRESOLVED');
  }

  async putLinks(
    receipt: TicketReceipt,
    result: JournalResult,
    context: UnitOfWorkContext,
  ) {
    if (!result.links) throw new TicketOperationError('INVALID');
    await this.contexts.updateOne(
      {
        instance: receipt.instance,
        group: receipt.group,
        ticketId: result.ticketId,
      },
      { $set: result.links, $setOnInsert: { createdBy: receipt.actor } },
      { upsert: true, session: this.session(context) },
    );
  }

  async nextSequence(
    receipt: TicketReceipt,
    ticketId: number,
    context: UnitOfWorkContext,
  ) {
    const row = await this.contexts.findOneAndUpdate(
      { instance: receipt.instance, group: receipt.group, ticketId },
      {
        $inc: { auditSequence: 1 },
        $setOnInsert: { incidentId: null, assetIds: [], maintenanceIds: [] },
      },
      { upsert: true, returnDocument: 'after', session: this.session(context) },
    );
    if (!row?.auditSequence) throw new TicketOperationError('UNAVAILABLE');
    return row.auditSequence;
  }

  async links(instance: string, group: number, ticketId: number) {
    const row = await this.contexts.findOne({ instance, group, ticketId });
    return row
      ? {
          incidentId: row.incidentId,
          assetIds: row.assetIds,
          maintenanceIds: row.maintenanceIds,
        }
      : null;
  }

  archive(instance: string, group: number, ticketId: number) {
    return this.archives.findOne({ instance, group, ticketId });
  }
  archived(instance: string, group: number, after: number, limit: number) {
    return this.archives
      .find({ instance, group, active: true, ticketId: { $gt: after } })
      .sort({ ticketId: 1 })
      .limit(limit)
      .toArray();
  }
  async putArchive(
    receipt: TicketReceipt,
    record: TicketArchiveRecord,
    context: UnitOfWorkContext,
  ) {
    if (record.instance !== receipt.instance || record.group !== receipt.group)
      throw new TicketOperationError('INVALID');
    const filter = {
      instance: record.instance,
      group: record.group,
      ticketId: record.ticketId,
      version: record.version - 1,
    };
    const written = await this.archives.replaceOne(filter, record, {
      session: this.session(context),
      upsert: record.version === 1,
    });
    if (!written.matchedCount && !written.upsertedCount)
      throw new TicketOperationError('CONFLICT');
  }
  evidenceById(instance: string, group: number, ticketId: number, id: string) {
    return this.evidence.findOne({ instance, group, ticketId, id });
  }
  evidenceByHash(
    instance: string,
    group: number,
    ticketId: number,
    sha256: string,
  ) {
    return this.evidence.findOne({ instance, group, ticketId, sha256 });
  }
  listEvidence(
    instance: string,
    group: number,
    ticketId: number,
    after: string,
    limit: number,
  ) {
    return this.evidence
      .find({ instance, group, ticketId, id: { $gt: after } })
      .sort({ id: 1 })
      .limit(limit)
      .toArray();
  }
  async putEvidence(
    receipt: TicketReceipt,
    record: TicketEvidenceRecord,
    context: UnitOfWorkContext,
  ) {
    if (record.instance !== receipt.instance || record.group !== receipt.group)
      throw new TicketOperationError('INVALID');
    await this.evidence.insertOne(record, { session: this.session(context) });
  }

  private session(context: UnitOfWorkContext) {
    const session = context as unknown as ClientSession;
    if (!session?.inTransaction())
      throw new TicketOperationError('UNAVAILABLE');
    return session;
  }
}

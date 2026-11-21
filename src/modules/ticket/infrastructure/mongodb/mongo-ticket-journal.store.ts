import type { ClientSession, Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import {
  TicketOperationError,
  type JournalResult,
  type TicketJournalStore,
  type TicketLinks,
  type TicketReceipt,
} from '../../application/ticket-journal';

interface BusinessContext extends TicketLinks {
  readonly instance: string;
  readonly group: number;
  readonly ticketId: number;
  readonly createdBy?: string;
  readonly auditSequence?: number;
}

export class MongoTicketJournalStore implements TicketJournalStore {
  private readonly receipts;
  private readonly contexts;

  constructor(connection: Connection) {
    const db = connection.getClient().db(connection.name);
    this.receipts = db.collection<TicketReceipt>('ticket_operation_receipts');
    this.contexts = db.collection<BusinessContext>('ticket_business_contexts');
  }

  async initialize() {
    await this.receipts.createIndex({ id: 1 }, { unique: true });
    await this.receipts.createIndex(
      { lock: 1 },
      { unique: true, sparse: true },
    );
    await this.contexts.createIndex(
      { instance: 1, group: 1, ticketId: 1 },
      { unique: true },
    );
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

  private session(context: UnitOfWorkContext) {
    const session = context as unknown as ClientSession;
    if (!session?.inTransaction())
      throw new TicketOperationError('UNAVAILABLE');
    return session;
  }
}

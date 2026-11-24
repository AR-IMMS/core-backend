import { createHash, randomUUID } from 'node:crypto';
import type { TicketNotificationKind } from './ticket-notifications';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION,
  type AuditFact,
  type AuditFactChange,
  type OutboxWriterPort,
  type UnitOfWorkContext,
  type UnitOfWorkPort,
} from '@platform/events';

export interface TicketLinks {
  readonly incidentId: string | null;
  readonly assetIds: readonly string[];
  readonly maintenanceIds: readonly string[];
}

export interface TicketArchiveRecord {
  readonly instance: string;
  readonly group: number;
  readonly ticketId: number;
  readonly active: boolean;
  readonly version: number;
  readonly archivedAt: string;
  readonly archivedByUserId: string;
  readonly archiveReason: string;
  readonly restoredAt?: string;
  readonly restoredByUserId?: string;
  readonly restoreReason?: string;
}
export interface TicketEvidenceRecord {
  readonly instance: string;
  readonly group: number;
  readonly ticketId: number;
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly uploadedByUserId: string;
  readonly createdAt: string;
  readonly sha256: string;
}
export interface JournalResult {
  readonly ticketId: number;
  readonly articleId?: number;
  readonly links?: TicketLinks;
  readonly archive?: TicketArchiveRecord;
  readonly evidence?: TicketEvidenceRecord;
  readonly notification?: {
    readonly kind: TicketNotificationKind;
    readonly recipients: readonly number[];
  };
  readonly changes: readonly AuditFactChange[];
}

export interface TicketReceipt {
  readonly id: string;
  readonly actor: string;
  readonly instance: string;
  readonly group: number;
  readonly action: string;
  readonly fingerprint: string;
  readonly lock?: string;
  readonly stage: 'dispatching' | 'verified' | 'succeeded' | 'failed';
  readonly occurredAt: string;
  readonly eventId: string;
  readonly notificationReadBy?: readonly string[];
  readonly result?: JournalResult;
}

export interface TicketJournalStore {
  find(id: string): Promise<TicketReceipt | null>;
  claim(receipt: TicketReceipt): Promise<TicketReceipt | null>;
  verify(id: string, result: JournalResult): Promise<void>;
  fail(id: string): Promise<void>;
  complete(id: string, context: UnitOfWorkContext): Promise<boolean>;
  nextSequence(
    receipt: TicketReceipt,
    ticketId: number,
    context: UnitOfWorkContext,
  ): Promise<number>;
  putLinks(
    receipt: TicketReceipt,
    result: JournalResult,
    context: UnitOfWorkContext,
  ): Promise<void>;
  archive?(
    instance: string,
    group: number,
    ticketId: number,
  ): Promise<TicketArchiveRecord | null>;
  archived?(
    instance: string,
    group: number,
    after: number,
    limit: number,
  ): Promise<TicketArchiveRecord[]>;
  putArchive?(
    receipt: TicketReceipt,
    record: TicketArchiveRecord,
    context: UnitOfWorkContext,
  ): Promise<void>;
  putEvidence?(
    receipt: TicketReceipt,
    record: TicketEvidenceRecord,
    context: UnitOfWorkContext,
  ): Promise<void>;
  links(
    instance: string,
    group: number,
    ticketId: number,
  ): Promise<TicketLinks | null>;
}

export class TicketOperationError extends Error {
  constructor(
    readonly code:
      | 'DENIED'
      | 'NOT_FOUND'
      | 'INVALID'
      | 'CONFLICT'
      | 'UNRESOLVED'
      | 'UNAVAILABLE'
      | 'TOO_LARGE'
      | 'INVALID_FILE',
  ) {
    super(`Ticket operation: ${code}`);
  }
}

interface OperationInput {
  readonly actor: string;
  readonly instance: string;
  readonly group: number;
  readonly key: string;
  readonly action: string;
  readonly ticketId?: number;
  readonly payload: object;
  readonly reconcileOnly?: boolean;
}

function hash(parts: unknown) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export class TicketJournal {
  constructor(
    private readonly store: TicketJournalStore,
    private readonly uow: UnitOfWorkPort,
    private readonly outbox: OutboxWriterPort,
  ) {}

  /**
   * A durable claim precedes dispatch. A dispatching receipt is never reissued.
   * A verified receipt can safely resume local completion after a restart.
   */
  async run(
    input: OperationInput,
    prepare: () => Promise<(marker: string) => Promise<JournalResult>>,
    recover?: (marker: string) => Promise<JournalResult>,
  ): Promise<JournalResult> {
    const id = hash([input.instance, input.group, input.actor, input.key]);
    const fingerprint = hash([
      input.action,
      input.ticketId ?? null,
      input.payload,
    ]);
    const intent: TicketReceipt = {
      id,
      fingerprint,
      actor: input.actor,
      instance: input.instance,
      group: input.group,
      action: input.action,
      ...(input.ticketId !== undefined
        ? { lock: hash([input.instance, input.group, input.ticketId]) }
        : {}),
      stage: 'dispatching',
      occurredAt: new Date().toISOString(),
      eventId: randomUUID(),
    };
    const existing = input.reconcileOnly
      ? await this.store.find(id)
      : await this.store.claim(intent);
    if (input.reconcileOnly && !existing)
      throw new TicketOperationError('CONFLICT');
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new TicketOperationError('CONFLICT');
      if (existing.stage === 'succeeded' && existing.result)
        return existing.result;
      if (existing.stage === 'verified' && existing.result)
        return this.finish(existing, existing.result);
      if (existing.stage === 'dispatching' && recover) {
        let result: JournalResult;
        try {
          result = await recover(id);
          await this.store.verify(id, result);
        } catch {
          throw new TicketOperationError('UNRESOLVED');
        }
        return this.finish(existing, result);
      }
      throw new TicketOperationError(
        existing.stage === 'failed' ? 'CONFLICT' : 'UNRESOLVED',
      );
    }

    let dispatch: (marker: string) => Promise<JournalResult>;
    try {
      dispatch = await prepare();
    } catch (error) {
      await this.store.fail(id);
      throw error;
    }

    let result: JournalResult;
    try {
      result = await dispatch(id);
      await this.store.verify(id, result);
    } catch {
      throw new TicketOperationError('UNRESOLVED');
    }
    return this.finish(intent, result);
  }

  private async finish(receipt: TicketReceipt, result: JournalResult) {
    const makeFact = (sequence: number): AuditFact => ({
      event_id: receipt.eventId,
      event_type: AUDIT_FACT_EVENT_TYPE,
      event_version: AUDIT_FACT_EVENT_VERSION,
      producer: 'ticket',
      occurred_at: receipt.occurredAt,
      resource: {
        type: 'ticket',
        id: JSON.stringify([receipt.instance, result.ticketId]),
        sequence,
      },
      payload: {
        actor: { type: 'user', id: receipt.actor },
        action: `ticket.${receipt.action}`,
        changes: [
          ...result.changes,
          { field: 'operation_id', after: receipt.id },
        ],
      },
      context: {},
    });
    try {
      await this.uow.run(async (context) => {
        if (!(await this.store.complete(receipt.id, context))) return;
        if (result.links) await this.store.putLinks(receipt, result, context);
        if (result.archive) {
          if (!this.store.putArchive)
            throw new TicketOperationError('UNAVAILABLE');
          await this.store.putArchive(receipt, result.archive, context);
        }
        if (result.evidence) {
          if (!this.store.putEvidence)
            throw new TicketOperationError('UNAVAILABLE');
          await this.store.putEvidence(receipt, result.evidence, context);
        }
        const sequence = await this.store.nextSequence(
          receipt,
          result.ticketId,
          context,
        );
        await this.outbox.append(makeFact(sequence), context);
      });
    } catch {
      throw new TicketOperationError('UNRESOLVED');
    }
    return result;
  }
}

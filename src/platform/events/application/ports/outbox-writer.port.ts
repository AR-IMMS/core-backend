import type { BusinessFactEnvelope } from '../../domain/business-fact-envelope';
import type { UnitOfWorkContext } from './unit-of-work.port';

/**
 * Producer-facing port for appending a fact in its business transaction.
 * @example `constructor(@Inject(OUTBOX_WRITER_PORT) private readonly outbox: OutboxWriterPort) {}`
 */
export interface OutboxWriterPort {
  /**
   * Appends a fact in the caller's active Unit of Work.
   * @param fact Immutable, versioned Business Fact to persist.
   * @param context Context created by `UnitOfWorkPort.run`.
   * @returns Promise fulfilled when the fact is written within the transaction.
   * @example `await outbox.append(fact, context)`
   */
  append<TPayload>(
    fact: BusinessFactEnvelope<TPayload>,
    context: UnitOfWorkContext,
  ): Promise<void>;
}

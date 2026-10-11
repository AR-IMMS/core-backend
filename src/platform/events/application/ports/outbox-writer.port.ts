import type { BusinessFactEnvelope } from '../../domain/business-fact-envelope';
import type { UnitOfWorkContext } from './unit-of-work.port';

/** Producer-facing port for appending a fact in its business transaction. */
export interface OutboxWriterPort {
  append<TPayload>(
    fact: BusinessFactEnvelope<TPayload>,
    context: UnitOfWorkContext,
  ): Promise<void>;
}

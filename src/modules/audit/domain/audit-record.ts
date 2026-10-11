import type { AuditActor } from '@platform/events';
import type { BusinessFactContext } from '@platform/events';

/** Durable Audit effect for one shared Audit Fact. */
export interface AuditRecord {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly producer: string;
  readonly actor: AuditActor;
  readonly action: string;
  readonly resource: {
    readonly type: string;
    readonly id: string;
  };
  readonly occurredAt: Date;
  readonly context: BusinessFactContext;
  readonly changes: readonly AuditChange[];
}

/** One producer-allowlisted scalar change. */
export interface AuditChange {
  readonly field: string;
  readonly before?: string | number | boolean | null;
  readonly after?: string | number | boolean | null;
}

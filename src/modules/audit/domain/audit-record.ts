import type { AuditActor } from '@platform/events';
import type { BusinessFactContext } from '@platform/events';
import type { AuditValueV2 } from '@platform/events';

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

/** One producer-allowlisted scalar or flat string-array change. */
export interface AuditChange {
  readonly field: string;
  readonly before?: AuditValueV2;
  readonly after?: AuditValueV2;
}

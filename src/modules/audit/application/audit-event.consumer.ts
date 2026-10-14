import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION as AUDIT_FACT_EVENT_VERSION_V1,
  AUDIT_FACT_EVENT_VERSION_V2,
  type BusinessFactSubscription,
  type EventConsumerPort,
  parseAuditFactPayload,
  parseAuditFactPayloadV2,
  type BusinessFactEnvelope,
} from '@platform/events';
import type { PermissionCatalogPort } from '@modules/iam';
import type { AuditRecordStorePort } from './ports/audit-record-store.port';

const AUDIT_FACT_SUBSCRIPTIONS: readonly BusinessFactSubscription[] = [
  {
    eventType: AUDIT_FACT_EVENT_TYPE,
    eventVersion: AUDIT_FACT_EVENT_VERSION_V1,
  },
  {
    eventType: AUDIT_FACT_EVENT_TYPE,
    eventVersion: AUDIT_FACT_EVENT_VERSION_V2,
  },
];

/** Validates and persists the shared business-neutral Audit Fact contract. */
export class AuditEventConsumer implements EventConsumerPort {
  readonly consumerId = 'audit';
  readonly subscriptions = AUDIT_FACT_SUBSCRIPTIONS;

  constructor(
    private readonly auditRecords: AuditRecordStorePort,
    private readonly permissionCatalog: PermissionCatalogPort,
  ) {}

  async handle(fact: BusinessFactEnvelope): Promise<void> {
    if (
      fact.event_type !== AUDIT_FACT_EVENT_TYPE ||
      (fact.event_version !== AUDIT_FACT_EVENT_VERSION_V1 &&
        fact.event_version !== AUDIT_FACT_EVENT_VERSION_V2)
    ) {
      throw new Error(
        `Audit only accepts ${AUDIT_FACT_EVENT_TYPE} versions 1 and 2`,
      );
    }

    const payload =
      fact.event_version === AUDIT_FACT_EVENT_VERSION_V1
        ? parseAuditFactPayload(fact.payload)
        : parseAuditFactPayloadV2(fact.payload, (code) =>
            this.permissionCatalog.isKnownPermissionCode(code),
          );
    const occurredAt = new Date(fact.occurred_at);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new TypeError('Audit Fact occurrence time is invalid');
    }
    const resourceType = nonEmptyString(fact.resource?.type, 'resource type');
    const resourceId = nonEmptyString(fact.resource?.id, 'resource id');
    if (
      !Number.isSafeInteger(fact.resource.sequence) ||
      fact.resource.sequence < 1
    ) {
      throw new TypeError('Audit Fact resource sequence is invalid');
    }
    const producer = nonEmptyString(fact.producer, 'producer');
    const eventId = nonEmptyString(fact.event_id, 'event ID');

    await this.auditRecords.appendIfAbsent({
      eventId,
      eventType: AUDIT_FACT_EVENT_TYPE,
      eventVersion: fact.event_version,
      producer,
      actor: payload.actor,
      action: payload.action,
      resource: { type: resourceType, id: resourceId },
      occurredAt,
      context: parseContext(fact.context),
      changes: payload.changes,
    });
  }
}

function parseContext(value: unknown): BusinessFactEnvelope['context'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Audit Fact context must be an object');
  }
  const context = value as Record<string, unknown>;
  const allowedKeys = new Set(['request_id', 'trace_id']);
  const unsupportedKey = Object.keys(context).find(
    (key) => !allowedKeys.has(key),
  );
  if (unsupportedKey) {
    throw new TypeError(
      `Audit Fact context field "${unsupportedKey}" is not permitted`,
    );
  }

  const requestId = optionalNonEmptyString(context.request_id, 'request_id');
  const traceId = optionalNonEmptyString(context.trace_id, 'trace_id');
  return {
    ...(requestId === undefined ? {} : { request_id: requestId }),
    ...(traceId === undefined ? {} : { trace_id: traceId }),
  };
}

function optionalNonEmptyString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  return nonEmptyString(value, label);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Audit Fact ${label} must be a non-empty string`);
  }
  return value;
}

import {
  businessFactVersion,
  type BusinessFactEnvelope,
} from '../domain/business-fact-envelope';

/** Shared business-neutral Audit Fact event type. */
export const AUDIT_FACT_EVENT_TYPE = 'audit.fact';
/** Current supported version of the shared Audit Fact contract. */
export const AUDIT_FACT_EVENT_VERSION = businessFactVersion(1);

/** Scalar values allowed in explicitly selected audit changes. */
export type AuditScalar = string | number | boolean | null;

/** Producer identity supplied by the module emitting an Audit Fact. */
export interface AuditActor {
  /** Actor category, such as a user or service. */
  readonly type: string;
  /** Stable actor identifier. */
  readonly id: string;
}

/** An explicit scalar field change; complete resource snapshots are excluded. */
export interface AuditFactChange {
  /** Explicit allowlisted field name. */
  readonly field: string;
  /** Previous scalar value, omitted when the field is newly set. */
  readonly before?: AuditScalar;
  /** New scalar value, omitted when the field is removed. */
  readonly after?: AuditScalar;
}

/** Business-neutral payload shared by all modules that emit Audit Facts. */
export interface AuditFactPayload {
  /** Actor responsible for the action. */
  readonly actor: AuditActor;
  /** Producer-defined business-neutral action name. */
  readonly action: string;
  /** Explicit scalar changes; no full resource snapshots. */
  readonly changes: readonly AuditFactChange[];
}

/** Shared versioned Audit Fact carried by the standard event envelope. */
export type AuditFact = BusinessFactEnvelope<
  AuditFactPayload,
  typeof AUDIT_FACT_EVENT_TYPE,
  typeof AUDIT_FACT_EVENT_VERSION
>;

const SENSITIVE_FIELD_NAME =
  /password|secret|token|credential|private.?key|authorization/i;

/**
 * Validates a wire payload before Audit stores it as a durable record.
 * @param payload Untrusted event payload received over the internal event boundary.
 * @returns Typed payload containing only supported fields and scalar changes.
 * @example `const payload = parseAuditFactPayload(fact.payload)`
 */
export function parseAuditFactPayload(payload: unknown): AuditFactPayload {
  if (!isRecord(payload)) {
    throw new TypeError('Audit Fact payload must be an object');
  }
  assertOnlyKeys(payload, ['actor', 'action', 'changes'], 'Audit Fact payload');

  if (!isRecord(payload.actor)) {
    throw new TypeError('Audit Fact actor must be an object');
  }
  assertOnlyKeys(payload.actor, ['type', 'id'], 'Audit Fact actor');
  const actorType = nonEmptyString(payload.actor.type, 'Audit Fact actor type');
  const actorId = nonEmptyString(payload.actor.id, 'Audit Fact actor id');
  const action = nonEmptyString(payload.action, 'Audit Fact action');
  if (!Array.isArray(payload.changes)) {
    throw new TypeError('Audit Fact changes must be an array');
  }

  const fields = new Set<string>();
  const changes = payload.changes.map((value, index): AuditFactChange => {
    if (!isRecord(value)) {
      throw new TypeError(`Audit Fact change ${index} must be an object`);
    }
    assertOnlyKeys(
      value,
      ['field', 'before', 'after'],
      `Audit Fact change ${index}`,
    );
    const field = nonEmptyString(
      value.field,
      `Audit Fact change ${index} field`,
    );
    if (SENSITIVE_FIELD_NAME.test(field)) {
      throw new TypeError(`Audit change field "${field}" is not permitted`);
    }
    if (fields.has(field)) {
      throw new TypeError(`Audit change field "${field}" is repeated`);
    }
    fields.add(field);

    const hasBefore = Object.hasOwn(value, 'before');
    const hasAfter = Object.hasOwn(value, 'after');
    if (!hasBefore && !hasAfter) {
      throw new TypeError(
        `Audit change field "${field}" must include before or after`,
      );
    }
    const before = hasBefore
      ? parseScalar(value.before, `Audit change "${field}" before`)
      : undefined;
    const after = hasAfter
      ? parseScalar(value.after, `Audit change "${field}" after`)
      : undefined;

    return {
      field,
      ...(hasBefore ? { before } : {}),
      ...(hasAfter ? { after } : {}),
    };
  });

  return {
    actor: { type: actorType, id: actorId },
    action,
    changes,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  description: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpectedKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpectedKey) {
    throw new TypeError(
      `${description} contains unsupported field "${unexpectedKey}"`,
    );
  }
}

function nonEmptyString(value: unknown, description: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${description} must be a non-empty string`);
  }
  return value;
}

function parseScalar(value: unknown, description: string): AuditScalar {
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'boolean' &&
    !(typeof value === 'number' && Number.isFinite(value))
  ) {
    throw new TypeError(`${description} must be a scalar value`);
  }
  return value;
}

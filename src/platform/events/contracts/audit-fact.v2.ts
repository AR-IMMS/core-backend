import {
  businessFactVersion,
  type BusinessFactEnvelope,
} from '../domain/business-fact-envelope';
import type { AuditActor, AuditScalar } from './audit-fact.v1';

/** Version 2 of the shared Audit Fact event contract. */
export const AUDIT_FACT_EVENT_VERSION_V2 = businessFactVersion(2);
/** Maximum serialized Audit Fact v2 payload size in UTF-8 bytes. */
export const AUDIT_FACT_V2_MAX_PAYLOAD_BYTES = 16 * 1024;
/** Maximum number of entries in either additional-permissions value. */
export const AUDIT_FACT_V2_MAX_PERMISSION_COUNT = 64;

/** Scalar or flat string-array values supported by Audit Fact v2. */
export type AuditValueV2 = AuditScalar | readonly string[];

/** One explicitly selected field change in an Audit Fact v2 payload. */
export interface AuditFactChangeV2 {
  readonly field: string;
  readonly before?: AuditValueV2;
  readonly after?: AuditValueV2;
}

/** Business-neutral Audit Fact v2 payload. */
export interface AuditFactPayloadV2 {
  readonly actor: AuditActor;
  readonly action: string;
  readonly changes: readonly AuditFactChangeV2[];
}

/** Shared versioned Audit Fact v2 carried by the standard event envelope. */
export type AuditFactV2 = BusinessFactEnvelope<
  AuditFactPayloadV2,
  'audit.fact',
  typeof AUDIT_FACT_EVENT_VERSION_V2
>;

/** Permission catalog membership check supplied by the owning module. */
export type IsPermissionCode = (code: string) => boolean;

const SENSITIVE_FIELD_NAME =
  /password|secret|token|credential|private.?key|authorization/i;
const SNAPSHOT_FIELD_NAME =
  /^(?:user|resource|snapshot|full[_-]?(?:user|resource)|(?:user|resource)[_-]snapshot)$/i;

/**
 * Validates an untrusted v2 payload without importing the permission catalog.
 * @param payload Untrusted event payload received over the internal boundary.
 * @param isPermissionCode Catalog membership predicate from IAM's public contract.
 * @returns Typed payload with copied scalar and flat string-array values.
 * @example `parseAuditFactPayloadV2(fact.payload, catalog.has.bind(catalog))`
 */
export function parseAuditFactPayloadV2(
  payload: unknown,
  isPermissionCode: IsPermissionCode,
): AuditFactPayloadV2 {
  assertPayloadSize(payload);
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
  const changes = payload.changes.map((value, index): AuditFactChangeV2 => {
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
    if (SENSITIVE_FIELD_NAME.test(field) || SNAPSHOT_FIELD_NAME.test(field)) {
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

    if (field === 'additional_permissions') {
      if (
        (hasBefore && !Array.isArray(value.before)) ||
        (hasAfter && !Array.isArray(value.after))
      ) {
        throw new TypeError(
          'Audit additional_permissions values must be an array of permission codes',
        );
      }
    }

    const before = hasBefore
      ? parseValue(value.before, `Audit change "${field}" before`)
      : undefined;
    const after = hasAfter
      ? parseValue(value.after, `Audit change "${field}" after`)
      : undefined;

    if (field === 'additional_permissions') {
      if (hasBefore) {
        validatePermissions(before, isPermissionCode, 'before');
      }
      if (hasAfter) {
        validatePermissions(after, isPermissionCode, 'after');
      }
    }

    return {
      field,
      ...(hasBefore ? { before } : {}),
      ...(hasAfter ? { after } : {}),
    };
  });

  return { actor: { type: actorType, id: actorId }, action, changes };
}

function assertPayloadSize(payload: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new TypeError('Audit Fact payload must be JSON serializable');
  }
  if (serialized === undefined) {
    throw new TypeError('Audit Fact payload must be JSON serializable');
  }
  if (
    new TextEncoder().encode(serialized).byteLength >
    AUDIT_FACT_V2_MAX_PAYLOAD_BYTES
  ) {
    throw new TypeError(
      `Audit Fact payload must not exceed ${AUDIT_FACT_V2_MAX_PAYLOAD_BYTES} UTF-8 bytes`,
    );
  }
}

function validatePermissions(
  value: AuditValueV2 | undefined,
  isPermissionCode: IsPermissionCode,
  side: string,
): void {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `Audit additional_permissions ${side} must be an array of permission codes`,
    );
  }
  if (value.length > AUDIT_FACT_V2_MAX_PERMISSION_COUNT) {
    throw new TypeError(
      `Audit additional_permissions ${side} may not contain more than ${AUDIT_FACT_V2_MAX_PERMISSION_COUNT} entries`,
    );
  }
  const uniqueCodes = new Set<string>();
  for (const candidate of value as unknown[]) {
    if (typeof candidate !== 'string' || !isPermissionCode(candidate)) {
      throw new TypeError(
        `Audit permission code "${String(candidate)}" is not in the permission catalog`,
      );
    }
    if (uniqueCodes.has(candidate)) {
      throw new TypeError(
        `Audit additional_permissions ${side} contains duplicate permission codes`,
      );
    }
    uniqueCodes.add(candidate);
  }
}

function parseValue(value: unknown, description: string): AuditValueV2 {
  if (Array.isArray(value)) {
    if (!value.every((entry) => typeof entry === 'string')) {
      throw new TypeError(`${description} must be an array of strings`);
    }
    return [...value] as string[];
  }
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'boolean' &&
    !(typeof value === 'number' && Number.isFinite(value))
  ) {
    throw new TypeError(
      `${description} must be a scalar value or an array of strings`,
    );
  }
  return value;
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

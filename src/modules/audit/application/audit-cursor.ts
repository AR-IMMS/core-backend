import type { AuditEventCursor } from '../domain/audit-query';

const MAX_AUDIT_CURSOR_LENGTH = 512;

/** Error raised when an opaque Audit event cursor cannot be decoded. */
export class InvalidAuditCursorError extends Error {
  constructor() {
    super('Audit cursor is invalid');
    this.name = 'InvalidAuditCursorError';
  }
}

/** Encodes a stable event position as an opaque base64url cursor. */
export function encodeAuditCursor(cursor: AuditEventCursor): string {
  return Buffer.from(
    JSON.stringify({
      occurred_at: cursor.occurredAt.toISOString(),
      event_id: cursor.eventId,
    }),
    'utf8',
  ).toString('base64url');
}

/** Decodes and validates an opaque cursor from an Audit list request. */
export function decodeAuditCursor(token: string): AuditEventCursor {
  if (token.length === 0 || token.length > MAX_AUDIT_CURSOR_LENGTH) {
    throw new InvalidAuditCursorError();
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(token, 'base64url').toString('utf8'),
    );
    if (!isRecord(parsed)) throw new InvalidAuditCursorError();
    const occurredAt = new Date(String(parsed.occurred_at));
    if (
      Number.isNaN(occurredAt.getTime()) ||
      typeof parsed.event_id !== 'string' ||
      parsed.event_id.trim().length === 0
    ) {
      throw new InvalidAuditCursorError();
    }
    return { occurredAt, eventId: parsed.event_id };
  } catch {
    throw new InvalidAuditCursorError();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

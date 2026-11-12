import { z } from 'zod';

export class InvalidAgentRegistryCursorError extends Error {}

const bindingCursorSchema = z.strictObject({
  created_at: z.iso.datetime({ offset: true }),
  binding_id: z.uuid(),
});

export function encodeInstallationCursor(installationId: string): string {
  return Buffer.from(installationId, 'utf8').toString('base64url');
}

export function decodeInstallationCursor(cursor: string): string {
  const value = decodeBase64Url(cursor);
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new InvalidAgentRegistryCursorError();
  return parsed.data;
}

export function encodeBindingsCursor(cursor: {
  readonly createdAt: Date;
  readonly bindingId: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      created_at: cursor.createdAt.toISOString(),
      binding_id: cursor.bindingId,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeBindingsCursor(cursor: string) {
  const value = decodeBase64Url(cursor);
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new InvalidAgentRegistryCursorError();
  }
  const parsed = bindingCursorSchema.safeParse(decoded);
  if (!parsed.success) throw new InvalidAgentRegistryCursorError();
  return {
    createdAt: new Date(parsed.data.created_at),
    bindingId: parsed.data.binding_id,
  };
}

function decodeBase64Url(cursor: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 512) {
    throw new InvalidAgentRegistryCursorError();
  }
  const value = Buffer.from(cursor, 'base64url').toString('utf8');
  if (Buffer.from(value, 'utf8').toString('base64url') !== cursor) {
    throw new InvalidAgentRegistryCursorError();
  }
  return value;
}

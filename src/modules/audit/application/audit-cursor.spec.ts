import { decodeAuditCursor, encodeAuditCursor } from './audit-cursor';

describe('Audit event cursor', () => {
  /** It round-trips the stable occurred-at and event-ID pagination position. */
  test('encodes and decodes a cursor position', () => {
    const cursor = {
      occurredAt: new Date('2026-10-08T00:00:00.000Z'),
      eventId: 'event-1',
    };

    expect(decodeAuditCursor(encodeAuditCursor(cursor))).toEqual(cursor);
  });

  /** It rejects malformed or oversized opaque cursors as client input errors. */
  test.each(['!', '', 'e30', 'x'.repeat(513)])(
    'rejects malformed cursor %s',
    (token) => {
      expect(() => decodeAuditCursor(token)).toThrow('Audit cursor is invalid');
    },
  );
});

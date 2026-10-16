import { auditEventListQuerySchema } from './audit-event-query.schema';

describe('auditEventListQuerySchema', () => {
  /** It applies the standard page-size default and accepts the documented filters. */
  test('parses defaults and filter values', () => {
    expect(
      auditEventListQuerySchema.parse({
        actor_id: 'admin-1',
        occurred_from: '2026-10-01T00:00:00.000Z',
      }),
    ).toEqual({
      page_size: 20,
      actor_id: 'admin-1',
      occurred_from: '2026-10-01T00:00:00.000Z',
    });
  });

  /** It rejects unknown parameters and blank filter strings. */
  test.each([
    { extra: 'no' },
    { actor_id: '   ' },
    { cursor: '   ' },
    { page_size: '101' },
  ])('rejects invalid query parameters', (query) => {
    expect(auditEventListQuerySchema.safeParse(query).success).toBe(false);
  });

  /** It rejects an occurrence range whose lower bound follows its upper bound. */
  test('rejects occurred_from after occurred_to', () => {
    expect(
      auditEventListQuerySchema.safeParse({
        occurred_from: '2026-10-02T00:00:00.000Z',
        occurred_to: '2026-10-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  /** It compares instants rather than ISO strings when timestamps use different offsets. */
  test('compares occurrence bounds using their timezone offsets', () => {
    expect(
      auditEventListQuerySchema.safeParse({
        occurred_from: '2026-10-01T00:30:00+01:00',
        occurred_to: '2026-10-01T00:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      auditEventListQuerySchema.safeParse({
        occurred_from: '2026-10-01T01:30:00Z',
        occurred_to: '2026-10-01T00:00:00+01:00',
      }).success,
    ).toBe(false);
  });
});

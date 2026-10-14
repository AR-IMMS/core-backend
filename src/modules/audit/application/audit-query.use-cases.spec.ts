import { GetAuditEventUseCase } from './get-audit-event.use-case';
import { ListAuditEventsUseCase } from './list-audit-events.use-case';
import type {
  AuditEventListQuery,
  AuditEventPage,
  AuditRecordView,
} from '../domain/audit-query';

const record: AuditRecordView = {
  eventId: 'event-1',
  eventType: 'audit.fact',
  eventVersion: 2,
  producer: 'iam',
  actor: { type: 'user', id: 'admin-1' },
  action: 'iam.user.permissions_replaced',
  resource: { type: 'user', id: 'user-2' },
  occurredAt: new Date('2026-10-08T00:00:00.000Z'),
  recordedAt: new Date('2026-10-08T00:00:01.000Z'),
  context: { request_id: 'request-1' },
  changes: [
    {
      field: 'additional_permissions',
      before: ['user:read'],
      after: ['asset:read', 'user:read'],
    },
  ],
};

describe('Audit query use cases', () => {
  /** It returns the query-store page without changing array-valued audit data. */
  test('lists records with the requested filters and preserves values', async () => {
    const query: AuditEventListQuery = {
      filters: { actorId: 'admin-1' },
      pageSize: 20,
    };
    const page: AuditEventPage = { items: [record], nextCursor: null };
    const list = jest.fn().mockResolvedValue(page);
    const get = jest.fn();
    const useCase = new ListAuditEventsUseCase({ list, getByEventId: get });

    await expect(useCase.execute(query)).resolves.toEqual(page);
    expect(list).toHaveBeenCalledWith(query);
  });

  /** It returns a matching stored Audit record or null for an unknown event ID. */
  test('gets one record by event ID', async () => {
    const getByEventId = jest.fn().mockResolvedValue(record);
    const useCase = new GetAuditEventUseCase({
      list: jest.fn(),
      getByEventId,
    });

    await expect(useCase.execute('event-1')).resolves.toBe(record);
    expect(getByEventId).toHaveBeenCalledWith('event-1');
  });
});

import type {
  AuditEventListQuery,
  AuditRecordView,
} from '../../domain/audit-query';
import {
  MongoAuditRecordStore,
  type MongoAuditRecordModel,
} from './mongo-audit-record.store';

function createQuery<TResult>(result: TResult) {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn(() => ({ exec }));
  const sort = jest.fn(() => ({ limit, lean }));
  const limit = jest.fn(() => ({ lean }));
  return { exec, lean, limit, sort };
}

function storedRecord(
  eventId: string,
  occurredAt: string,
  changes: AuditRecordView['changes'] = [],
) {
  return {
    eventId,
    eventType: 'audit.fact',
    eventVersion: 2,
    producer: 'iam',
    actor: { type: 'user', id: 'admin-1' },
    action: 'iam.user.permissions_replaced',
    resource: { type: 'user', id: 'user-2' },
    occurredAt: new Date(occurredAt),
    createdAt: new Date('2026-10-08T00:00:01.000Z'),
    context: { request_id: 'request-1' },
    changes,
  };
}

describe('MongoAuditRecordStore query methods', () => {
  /** It returns a page, keeps array changes intact, and creates an opaque next cursor. */
  test('lists records in descending order with one look-ahead record', async () => {
    const rows = [
      storedRecord('event-2', '2026-10-08T00:00:02.000Z', [
        {
          field: 'additional_permissions',
          before: ['user:read'],
          after: ['asset:read'],
        },
      ]),
      storedRecord('event-1', '2026-10-08T00:00:01.000Z'),
    ];
    const query = createQuery(rows);
    const find: MongoAuditRecordModel['find'] = jest.fn((filter) => {
      void filter;
      return query as unknown as ReturnType<MongoAuditRecordModel['find']>;
    });
    const model: MongoAuditRecordModel = {
      create: jest.fn(),
      find,
      findOne: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
    };
    const store = new MongoAuditRecordStore(model);

    const page = await store.list({ filters: {}, pageSize: 1 });

    expect(find).toHaveBeenCalledWith({});
    expect(query.sort).toHaveBeenCalledWith({ occurredAt: -1, eventId: -1 });
    expect(query.limit).toHaveBeenCalledWith(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.changes[0]?.after).toEqual(['asset:read']);
    expect(page.items[0]?.recordedAt).toEqual(
      new Date('2026-10-08T00:00:01.000Z'),
    );
    expect(page.nextCursor).toEqual({
      occurredAt: new Date('2026-10-08T00:00:02.000Z'),
      eventId: 'event-2',
    });
  });

  /** It applies all supplied filters and the stable keyset cursor predicate. */
  test('builds Mongo filters for audit fields and cursor position', async () => {
    const cursorDate = new Date('2026-10-08T00:00:03.000Z');
    const query: AuditEventListQuery = {
      filters: {
        occurredFrom: new Date('2026-10-01T00:00:00.000Z'),
        occurredTo: new Date('2026-10-31T23:59:59.000Z'),
        actorId: 'admin-1',
        action: 'iam.user.permissions_replaced',
        resourceType: 'user',
        resourceId: 'user-2',
        requestId: 'request-1',
      },
      pageSize: 10,
      cursor: { occurredAt: cursorDate, eventId: 'event-3' },
    };
    const find: MongoAuditRecordModel['find'] = jest.fn((filter) => {
      void filter;
      return createQuery([]) as unknown as ReturnType<
        MongoAuditRecordModel['find']
      >;
    });
    const model: MongoAuditRecordModel = {
      create: jest.fn(),
      find,
      findOne: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
    };
    const store = new MongoAuditRecordStore(model);

    await store.list(query);

    expect(find).toHaveBeenCalledWith({
      occurredAt: {
        $gte: query.filters.occurredFrom,
        $lte: query.filters.occurredTo,
      },
      'actor.id': 'admin-1',
      action: 'iam.user.permissions_replaced',
      'resource.type': 'user',
      'resource.id': 'user-2',
      'context.request_id': 'request-1',
      $or: [
        { occurredAt: { $lt: cursorDate } },
        { occurredAt: cursorDate, eventId: { $lt: 'event-3' } },
      ],
    });
  });

  /** It maps one stored record's createdAt timestamp to the public recordedAt field. */
  test('gets one record by event ID with its recorded timestamp', async () => {
    const row = storedRecord('event-1', '2026-10-08T00:00:00.000Z');
    const exec = jest.fn().mockResolvedValue(row);
    const lean = jest.fn(() => ({ exec }));
    const findOne = jest.fn(() => ({ lean }));
    const store = new MongoAuditRecordStore({
      create: jest.fn(),
      find: jest.fn(),
      findOne,
    });

    await expect(store.getByEventId('event-1')).resolves.toMatchObject({
      eventId: 'event-1',
      eventVersion: 2,
      recordedAt: row.createdAt,
    });
    expect(findOne).toHaveBeenCalledWith({ eventId: 'event-1' });
  });
});

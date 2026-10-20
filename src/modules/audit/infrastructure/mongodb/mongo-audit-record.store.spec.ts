import { AuditRecordSchema } from './audit-record.schema';
import {
  MongoAuditRecordStore,
  type MongoAuditRecordModel,
} from './mongo-audit-record.store';
import type { AuditRecord } from '../../domain/audit-record';

const record: AuditRecord = {
  eventId: 'event-1',
  eventType: 'asset.registered',
  eventVersion: 1,
  producer: 'asset',
  actor: { type: 'user', id: 'user-1' },
  action: 'asset.registered',
  resource: { type: 'asset', id: 'asset-1' },
  occurredAt: new Date('2026-10-08T00:00:00.000Z'),
  context: { request_id: 'request-1' },
  changes: [],
};

describe('MongoAuditRecordStore', () => {
  /** It persists v2 permission arrays as JSON arrays without converting them to strings. */
  test('stores v2 before and after arrays unchanged', async () => {
    const recordWithPermissionArrays: AuditRecord = {
      ...record,
      eventVersion: 2,
      changes: [
        {
          field: 'additional_permissions',
          before: ['user:read'],
          after: ['asset:read', 'user:read'],
        },
      ],
    };
    const create = jest.fn().mockResolvedValue([recordWithPermissionArrays]);
    const store = new MongoAuditRecordStore({
      create,
      find: jest.fn(),
      findOne: jest.fn(),
    });

    await store.appendIfAbsent(recordWithPermissionArrays);

    expect(create).toHaveBeenCalledWith([recordWithPermissionArrays]);
    expect(recordWithPermissionArrays.changes[0]?.after).toEqual([
      'asset:read',
      'user:read',
    ]);
  });

  test('stores a record as one append-only event-id keyed effect', async () => {
    const create = jest.fn().mockResolvedValue([record]);
    const model: MongoAuditRecordModel = {
      create,
      find: jest.fn(),
      findOne: jest.fn(),
    };
    const store = new MongoAuditRecordStore(model);

    await expect(store.appendIfAbsent(record)).resolves.toBe('inserted');

    expect(create.mock.calls).toEqual([[[record]]]);
    expect(AuditRecordSchema.indexes()).toContainEqual([
      { eventId: 1 },
      expect.objectContaining({ unique: true }),
    ]);
  });

  test('acknowledges only a duplicate event-id conflict as already processed', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('duplicate key'), { code: 11000 }),
      );
    const model: MongoAuditRecordModel = {
      create,
      find: jest.fn(),
      findOne: jest.fn(),
    };
    const store = new MongoAuditRecordStore(model);

    await expect(store.appendIfAbsent(record)).resolves.toBe('duplicate');
  });

  test('propagates non-duplicate persistence failures for relay retry', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Error('database unavailable'));
    const model: MongoAuditRecordModel = {
      create,
      find: jest.fn(),
      findOne: jest.fn(),
    };
    const store = new MongoAuditRecordStore(model);

    await expect(store.appendIfAbsent(record)).rejects.toThrow(
      'database unavailable',
    );
  });
});

import { MongoNodeLifecycleOperationStore } from '../mongo-node-lifecycle-operation.store';
import type { AssetMongoCollection } from '../asset-mongo.types';

class FakeCollection implements AssetMongoCollection {
  readonly documents: Record<string, unknown>[] = [];
  lastSession: unknown;
  createIndex(): Promise<string> {
    return Promise.resolve('index');
  }
  insertOne(document: Readonly<Record<string, unknown>>): Promise<unknown> {
    const duplicate = this.documents.some(
      (current) =>
        current['operationId'] === document['operationId'] ||
        (typeof document['idempotencyHash'] === 'string' &&
          current['idempotencyHash'] === document['idempotencyHash']) ||
        (current['nodeId'] === document['nodeId'] &&
          current['stage'] !== 'COMPLETE'),
    );
    if (duplicate)
      return Promise.reject(
        Object.assign(new Error('duplicate key'), { code: 11000 }),
      );
    this.documents.push({ ...document });
    return Promise.resolve({});
  }
  findOne(
    filter: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown> | null> {
    return Promise.resolve(
      this.documents.find((document) => matches(document, filter)) ?? null,
    );
  }
  updateOne(
    filter: Readonly<Record<string, unknown>>,
    update: Readonly<Record<string, unknown>>,
    options?: { readonly session?: never },
  ): Promise<{ matchedCount: number }> {
    this.lastSession = options?.session;
    const document = this.documents.find((item) => matches(item, filter));
    if (!document) return Promise.resolve({ matchedCount: 0 });
    Object.assign(document, update['$set']);
    return Promise.resolve({ matchedCount: 1 });
  }
  find(filter: Readonly<Record<string, unknown>>) {
    return {
      sort: () => ({
        limit: (count: number) => ({
          toArray: () =>
            Promise.resolve(
              this.documents
                .filter((item) => matches(item, filter))
                .slice(0, count),
            ),
        }),
      }),
    };
  }
}

function matches(
  document: Record<string, unknown>,
  filter: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = document[key];
    if (expected && typeof expected === 'object' && '$ne' in expected)
      return actual !== expected['$ne'];
    if (expected && typeof expected === 'object' && '$in' in expected)
      return (expected['$in'] as unknown[]).includes(actual);
    return actual === expected;
  });
}

describe('MongoNodeLifecycleOperationStore', () => {
  const collection = new FakeCollection();
  let store: MongoNodeLifecycleOperationStore;
  const now = new Date('2026-11-22T12:00:00Z');
  beforeEach(() => {
    collection.documents.length = 0;
    store = new MongoNodeLifecycleOperationStore({
      db: { collection: () => collection },
    } as never);
  });

  const begin = (overrides: Record<string, unknown> = {}) =>
    store.begin({
      operationId: 'op-1',
      nodeId: 'node-1',
      action: 'UNMAP',
      actor: { type: 'user', id: 'admin-1' },
      idempotencyHash: null,
      fingerprint: 'fingerprint-1',
      now,
      ...overrides,
    } as never);

  it('reuses the one pending no-key operation for the same actor and intent', async () => {
    const first = await begin();
    const retry = await begin({ operationId: 'op-2' });
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.operation.operationId).toBe('op-1');
  });

  it('converges concurrent no-key requests on one pending Node operation', async () => {
    const [left, right] = await Promise.all([
      begin({ operationId: 'op-left' }),
      begin({ operationId: 'op-right' }),
    ]);
    expect(collection.documents).toHaveLength(1);
    expect(left.operation.operationId).toBe(right.operation.operationId);
    expect([left.created, right.created].filter(Boolean)).toHaveLength(1);
  });

  it('rejects one idempotency key reused with another actor or intent', async () => {
    await begin({ idempotencyHash: 'same-key-hash' });
    await expect(
      begin({
        idempotencyHash: 'same-key-hash',
        fingerprint: 'different-intent',
      }),
    ).rejects.toMatchObject({ code: 'NODE_LIFECYCLE_IDEMPOTENCY_CONFLICT' });
  });

  it('stores the committed outcome using the caller transaction session', async () => {
    await begin();
    const gate = {
      nodeId: 'node-1',
      operationId: 'op-1',
      version: 2,
      previousState: 'OPEN' as const,
      activeBinding: null,
    };
    await store.recordGate('op-1', gate, now);
    const session = {} as never;
    await store.recordOutcome(
      { operationId: 'op-1', outcome: 'COMMIT', now },
      session,
    );
    expect(collection.lastSession).toBe(session);
    await expect(store.findById('op-1')).resolves.toMatchObject({
      stage: 'COMMIT_PENDING_GATE_FINALIZE',
      outcome: 'COMMIT',
      gate,
    });
  });
});

import assert from 'node:assert/strict';
import { MongoIdentityMappingWriter } from '../src/modules/ticket/infrastructure/mongodb/mongo-identity-mapping.writer';
import { MongoUnitOfWork } from '../src/platform/events/infrastructure/mongodb/mongo-unit-of-work';
import {
  MongoOutboxStore,
  type MongoOutboxModel,
} from '../src/platform/events/infrastructure/mongodb/mongo-outbox.store';
import {
  OutboxEntrySchema,
  type OutboxEntry,
} from '../src/platform/events/infrastructure/mongodb/outbox.schema';
import { ProvisionIdentityMapping } from '../src/modules/ticket/application/provision-identity-mapping';
import type { UnitOfWorkContext } from '../src/platform/events';
import {
  describe,
  it,
  before as beforeAll,
  after as afterAll,
  afterEach,
} from 'node:test';
import { createConnection, type Connection, type Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { resolveMongoTestConfig } from './mongodb-test-config';
import { IdentityMappingSchema } from '../src/modules/ticket/infrastructure/mongodb/identity-mapping.schema';
import { MongoIdentityMappingStore } from '../src/modules/ticket/infrastructure/mongodb/mongo-identity-mapping.store';
import type { IdentityMapping } from '../src/modules/ticket/domain/identity-mapping';

void describe('Ticket identity persistence (dedicated Mongo)', () => {
  let connection: Connection;
  let model: Model<IdentityMapping>;
  let store: MongoIdentityMappingStore;
  let outboxModel: Model<OutboxEntry>;
  const instanceKey = `test-${randomUUID()}`;
  const row: IdentityMapping = {
    instanceKey,
    coreUserId: 'synthetic-a',
    zammadUserId: 900001,
    approvedGroupId: 42,
    status: 'ACTIVE',
    revision: 1,
    approvedByCoreUserId: 'synthetic-admin',
    approvalReference: 'test-fixture',
    validatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  beforeAll(async () => {
    const config = resolveMongoTestConfig();
    connection = await createConnection(config.uri, {
      serverSelectionTimeoutMS: 5000,
    }).asPromise();
    const hello = await connection.db!.admin().command({ hello: 1 });
    assert.equal(
      hello.setName,
      new URL(config.uri).searchParams.get('replicaSet'),
      'Test server must be the requested replica set',
    );
    model = connection.model<IdentityMapping>(
      'TicketIdentityTest',
      IdentityMappingSchema,
    );
    await model.createIndexes();
    outboxModel = connection.model<OutboxEntry>(
      'TicketProvisionOutboxTest',
      OutboxEntrySchema,
    );
    await outboxModel.createIndexes();
    store = new MongoIdentityMappingStore(model, {
      instanceKey,
      approvedGroupId: 42,
    });
  });
  afterEach(async () => {
    if (model) await model.deleteMany({ instanceKey });
    if (outboxModel)
      await outboxModel.deleteMany({
        'fact.resource.id': JSON.stringify([instanceKey, row.coreUserId]),
      });
  });
  afterAll(async () => {
    if (connection) await connection.close();
  });
  void it('reads explicit binding and returns null for missing identity', async () => {
    await model.create(row);
    assert.equal(
      (await store.findActiveMapping('synthetic-a'))?.zammadUserId,
      900001,
    );
    assert.equal(await store.findActiveMapping('missing'), null);
  });
  for (const status of ['ACTIVE', 'REVOKED'] as const) {
    void it(`enforces both unique directions for ${status}`, async () => {
      await model.create({ ...row, status });
      await assert.rejects(model.create({ ...row, zammadUserId: 900002 }), {
        code: 11000,
      });
      await assert.rejects(
        model.create({ ...row, coreUserId: 'synthetic-b' }),
        { code: 11000 },
      );
    });
  }
  void it('paginates active scoped mapping candidates without using stable Core or Zammad IDs as cursors', async () => {
    await model.create([
      row,
      {
        ...row,
        coreUserId: 'synthetic-revoked',
        zammadUserId: 900002,
        status: 'REVOKED',
      },
      {
        ...row,
        coreUserId: 'synthetic-wrong-group',
        zammadUserId: 900003,
        approvedGroupId: 43,
      },
      { ...row, coreUserId: 'synthetic-b', zammadUserId: 900004 },
    ]);
    const first = await store.listCandidates(undefined, 1);
    assert.deepEqual(
      first.map(({ id }) => id),
      [row.coreUserId],
    );
    assert.match(first[0].cursor, /^[a-f0-9]{24}$/);
    const rest = await store.listCandidates(first[0].cursor, 10);
    assert.deepEqual(
      rest.map(({ id }) => id),
      ['synthetic-b'],
    );
  });
  void it('denies revoked mappings', async () => {
    await model.create({ ...row, status: 'REVOKED' });
    assert.equal(await store.findActiveMapping(row.coreUserId), null);
  });
  void it('rejects unsupported inactive status at persistence boundary', async () => {
    await assert.rejects(
      model.create({ ...row, status: 'INACTIVE' as IdentityMapping['status'] }),
    );
  });
  void it('denies wrong group', async () => {
    await model.create({ ...row, approvedGroupId: 43 });
    assert.equal(await store.findActiveMapping(row.coreUserId), null);
  });
  void it('does not cross instance boundaries', async () => {
    await model.create(row);
    const other = new MongoIdentityMappingStore(model, {
      instanceKey: 'other',
      approvedGroupId: 42,
    });
    assert.equal(await other.findActiveMapping(row.coreUserId), null);
  });
  void it('denies corrupted persisted data', async () => {
    await model.collection.insertOne({
      ...row,
      revision: 0,
    });
    await assert.rejects(store.findActiveMapping(row.coreUserId), {
      code: 'MAPPING_INTEGRITY',
    });
  });
  let appended = false;
  function provisioning(failAudit = false) {
    appended = false;
    const writer = new MongoIdentityMappingWriter(model);
    const outbox = new MongoOutboxStore(
      outboxModel as unknown as MongoOutboxModel,
    );
    return new ProvisionIdentityMapping(
      {
        getPrincipal: (id) =>
          Promise.resolve({
            userId: id,
            status: 'ACTIVE',
            role: id === row.approvedByCoreUserId ? 'IT_ADMIN' : 'OPERATOR',
          }),
        hasAllPermissions: () => Promise.resolve(true),
      },
      {
        authorize: () =>
          Promise.resolve({
            actorUserId: row.approvedByCoreUserId,
            approvalReference: 'synthetic-approved-fixture',
          }),
      },
      {
        getEligibleHuman: () =>
          Promise.resolve({
            externalUserId: row.zammadUserId,
            groupId: row.approvedGroupId,
          }),
      },
      writer,
      new MongoUnitOfWork(connection),
      {
        append: async (fact, context) => {
          await outbox.append(fact, context);
          appended = true;
          if (failAudit) throw new Error('simulated append failure');
        },
      },
      row,
    );
  }
  const provisionRequest = {
    instanceKey,
    approvedGroupId: 42,
    actorUserId: row.approvedByCoreUserId,
    coreUserId: row.coreUserId,
    zammadUserId: row.zammadUserId,
  };
  void it('atomically commits a synthetic mapping and its Audit outbox fact', async () => {
    await provisioning().execute(provisionRequest);
    assert.equal(await model.countDocuments({ instanceKey }), 1);
    const entry = await outboxModel
      .findOne({
        'fact.resource.id': JSON.stringify([instanceKey, row.coreUserId]),
      })
      .lean();
    assert(entry);
    assert.equal(
      await outboxModel.countDocuments({
        'fact.resource.id': JSON.stringify([instanceKey, row.coreUserId]),
        'fact.payload.action': 'ticket.identity_mapping.created',
      }),
      1,
    );
  });
  void it('rolls back both mapping and Audit fact if transaction fails after append', async () => {
    await assert.rejects(provisioning(true).execute(provisionRequest), {
      code: 'DEPENDENCY_FAILURE',
    });
    assert.equal(appended, true);
    assert.equal(await model.countDocuments({ instanceKey }), 0);
    assert.equal(
      await outboxModel.countDocuments({
        'fact.resource.id': JSON.stringify([instanceKey, row.coreUserId]),
      }),
      0,
    );
  });
  void it('does not rebind or reactivate a revoked binding and emits no false Audit success', async () => {
    await model.create({ ...row, status: 'REVOKED' });
    await assert.rejects(provisioning().execute(provisionRequest), {
      code: 'CONFLICT',
    });
    assert.equal((await model.findOne({ instanceKey }))?.status, 'REVOKED');
    assert.equal(
      await outboxModel.countDocuments({
        'fact.resource.id': JSON.stringify([instanceKey, row.coreUserId]),
      }),
      0,
    );
  });
  void it('refuses a write without an active Mongo transaction', async () => {
    await assert.rejects(
      new MongoIdentityMappingWriter(model).insert(
        row,
        {} as UnitOfWorkContext,
      ),
      { code: 'DEPENDENCY_FAILURE' },
    );
    assert.equal(await model.countDocuments({ instanceKey }), 0);
  });
  void it('reads Business Owner mapping by exact external identity and checks both directions', async () => {
    await model.create(row);
    assert.equal(
      (await store.findActiveMappingByExternalId(row.zammadUserId))?.coreUserId,
      row.coreUserId,
    );
    assert.equal(await store.findActiveMappingByExternalId(900002), null);
  });
  void it('does not return revoked or wrong-group Business Owner bindings', async () => {
    await model.create({ ...row, status: 'REVOKED' });
    assert.equal(
      await store.findActiveMappingByExternalId(row.zammadUserId),
      null,
    );
    await model.updateOne(
      { instanceKey },
      { status: 'ACTIVE', approvedGroupId: 43 },
    );
    assert.equal(
      await store.findActiveMappingByExternalId(row.zammadUserId),
      null,
    );
  });
});

/* eslint-disable @typescript-eslint/require-await -- Structural Mongoose query-chain doubles use fluent dynamic mocks. */
import { MongoAssetStore } from '../mongo-asset.store';
import { Asset } from '../../../domain/asset/asset';

describe('MongoAssetStore', () => {
  it('maps a persisted Asset and preserves its immutable classification', async () => {
    const doc = {
      id: 'asset-1',
      name: 'Node 01',
      assetTypeId: 'type-node',
      assetModelId: 'model-1',
      serialNumber: 'serial-1',
      lifecycleState: 'ACTIVE',
      auditSequence: 3,
    };
    const assets = {
      findOne: jest.fn(() => ({ lean: () => ({ exec: async () => doc }) })),
    };
    const store = new MongoAssetStore(
      assets as never,
      {} as never,
      {} as never,
    );

    const result = await store.findById('asset-1');

    expect(result).toMatchObject({
      id: 'asset-1',
      name: 'Node 01',
      assetTypeId: 'type-node',
      assetModelId: 'model-1',
      lifecycleState: 'ACTIVE',
    });
  });

  it('returns a deterministic Asset-ID cursor page and detects another page', async () => {
    const docs = [
      {
        id: 'asset-1',
        name: 'A',
        assetTypeId: 'type-node',
        lifecycleState: 'ACTIVE',
        auditSequence: 0,
      },
      {
        id: 'asset-2',
        name: 'B',
        assetTypeId: 'type-node',
        lifecycleState: 'ACTIVE',
        auditSequence: 0,
      },
      {
        id: 'asset-3',
        name: 'C',
        assetTypeId: 'type-node',
        lifecycleState: 'ACTIVE',
        auditSequence: 0,
      },
    ];
    const query: { sort: jest.Mock; limit: jest.Mock; lean: jest.Mock } = {
      sort: jest.fn(),
      limit: jest.fn(),
      lean: jest.fn(() => ({ exec: async () => docs })),
    };
    query.sort.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const assets = { find: jest.fn(() => query) };
    const store = new MongoAssetStore(
      assets as never,
      {} as never,
      {} as never,
    );

    const page = await store.list({ afterAssetId: 'asset-0', limit: 2 });

    expect(assets.find).toHaveBeenCalledWith({ id: { $gt: 'asset-0' } });
    expect(query.sort).toHaveBeenCalledWith({ id: 1 });
    expect(page.items.map(({ id }) => id)).toEqual(['asset-1', 'asset-2']);
    expect(page.hasMore).toBe(true);
  });

  it('increments the Audit sequence without rewriting the immutable Type', async () => {
    const updated = { auditSequence: 4 };
    const query = { lean: () => ({ exec: async () => updated }) };
    const findOneAndUpdate = jest.fn(
      (...args: [Record<string, unknown>, Record<string, unknown>]) => {
        void args;
        return query;
      },
    );
    const assets = { findOneAndUpdate };
    const store = new MongoAssetStore(
      assets as never,
      {} as never,
      {} as never,
    );
    const asset = Asset.register({
      id: 'asset-1',
      name: 'Node',
      type: { id: 'type-node' },
    });

    await expect(store.save(asset, {} as never)).resolves.toBe(4);

    const [, update] = findOneAndUpdate.mock.calls[0];
    expect(findOneAndUpdate.mock.calls[0][0]).toEqual({ id: 'asset-1' });
    expect(update).toMatchObject({
      $setOnInsert: { id: 'asset-1', assetTypeId: 'type-node' },
      $inc: { auditSequence: 1 },
    });
    expect(
      (update as { $set?: Record<string, unknown> } | undefined)?.$set,
    ).not.toHaveProperty('assetTypeId');
  });

  it('looks up Type and Model references by their canonical catalog IDs', async () => {
    const types = {
      findOne: jest.fn(() => ({
        select: () => ({
          lean: () => ({ exec: async () => ({ id: 'type-node' }) }),
        }),
      })),
    };
    const models = {
      findOne: jest.fn(() => ({
        select: () => ({
          lean: () => ({
            exec: async () => ({ id: 'model-1', assetTypeId: 'type-node' }),
          }),
        }),
      })),
    };
    const store = new MongoAssetStore(
      {} as never,
      types as never,
      models as never,
    );

    await expect(store.findType('type-node')).resolves.toEqual({
      id: 'type-node',
    });
    await expect(store.findModel('model-1')).resolves.toEqual({
      id: 'model-1',
      assetTypeId: 'type-node',
    });
  });
});
/* eslint-enable @typescript-eslint/require-await */

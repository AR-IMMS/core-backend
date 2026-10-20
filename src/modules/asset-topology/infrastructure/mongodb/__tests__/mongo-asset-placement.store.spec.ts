import { AssetPlacement } from '../../../domain/placement/asset-placement';
import {
  AssetPlacementConflictError,
  ActiveAssetPlacementNotFoundError,
} from '../../../application/placements/asset-placement-store.port';
import { MongoAssetPlacementStore } from '../mongo-asset-placement.store';

describe('MongoAssetPlacementStore', () => {
  const context = {} as never;
  const location = AssetPlacement.start({
    id: 'location-1',
    assetId: 'asset-1',
    rackId: 'rack-1',
    uPosition: 7,
    placedAt: new Date('2026-10-19T00:00:00.000Z'),
  });

  it('queries one active placement by Asset in the caller transaction', async () => {
    const queryResult = query({
      id: 'location-1',
      assetId: 'asset-1',
      rackId: 'rack-1',
      uPosition: 7,
      validFrom: new Date('2026-10-19T00:00:00.000Z'),
    });
    const model = { findOne: jest.fn(() => queryResult) };
    const store = new MongoAssetPlacementStore(model as never);

    await expect(
      store.findActiveByAsset('asset-1', context),
    ).resolves.toMatchObject({
      id: 'location-1',
      rackId: 'rack-1',
      uPosition: { value: 7 },
    });
    expect(model.findOne).toHaveBeenCalledWith({
      assetId: 'asset-1',
      validTo: { $exists: false },
    });
    expect(queryResult.session).toHaveBeenCalledWith(context);
  });

  it('persists an Asset Location interval in the caller transaction', async () => {
    const queryResult = query({ id: 'location-1' });
    const model = { findOneAndUpdate: jest.fn(() => queryResult) };
    const store = new MongoAssetPlacementStore(model as never);

    await store.save(location, context);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { id: 'location-1' },
      {
        $setOnInsert: {
          id: 'location-1',
          assetId: 'asset-1',
          rackId: 'rack-1',
          uPosition: 7,
          validFrom: location.validFrom,
        },
      },
      { upsert: true, new: true, session: context },
    );
  });

  it('maps unique-index violations to a placement conflict', async () => {
    const queryResult = query(null);
    queryResult.exec.mockRejectedValue({ code: 11000 });
    const model = { findOneAndUpdate: jest.fn(() => queryResult) };
    const store = new MongoAssetPlacementStore(model as never);

    await expect(store.save(location, context)).rejects.toBeInstanceOf(
      AssetPlacementConflictError,
    );
  });

  it('requires an active interval to close', async () => {
    const model = {
      updateOne: jest.fn(() => query({ modifiedCount: 0 })),
    };
    const store = new MongoAssetPlacementStore(model as never);

    await expect(
      store.closeActive('asset-1', new Date(), context),
    ).rejects.toBeInstanceOf(ActiveAssetPlacementNotFoundError);
  });
});

function query<TResult>(value: TResult) {
  const exec = jest.fn().mockResolvedValue(value);
  const chain: {
    sort: jest.Mock;
    session: jest.Mock;
    lean: jest.Mock;
    exec: jest.Mock;
    modifiedCount: number;
  } = {} as never;
  Object.assign(chain, {
    sort: jest.fn(() => chain),
    session: jest.fn(() => chain),
    lean: jest.fn(() => ({ exec })),
    exec,
    modifiedCount: 1,
  });
  return chain;
}

import { Rack } from '../../../domain/topology/rack';
import { RackLocation } from '../../../domain/topology/rack-location';
import { MongoRackStore } from '../mongo-rack.store';

describe('MongoRackStore', () => {
  it('maps the active Rack location and uses its one-cell coordinates', async () => {
    const rackModel = {};
    const locationDoc = {
      id: 'location-1',
      rackId: 'rack-1',
      roomId: 'room-1',
      column: 2,
      row: 3,
      rotation: 90,
      validFrom: new Date('2026-01-01T00:00:00Z'),
    };
    const locations = {
      findOne: jest.fn(() => query(locationDoc)),
      find: jest.fn(),
    };
    const store = new MongoRackStore(rackModel as never, locations as never);

    const location = await store.getActiveLocation('rack-1');

    expect(location).toBeInstanceOf(RackLocation);
    expect(location).toMatchObject({
      rackId: 'rack-1',
      roomId: 'room-1',
      placement: { column: 2, row: 3, rotation: 90 },
    });
    expect(locations.findOne).toHaveBeenCalledWith({
      rackId: 'rack-1',
      validTo: { $exists: false },
    });
  });

  it('increments Rack audit sequence in the caller transaction', async () => {
    const result = { auditSequence: 4 };
    const racks = { findOneAndUpdate: jest.fn(() => query(result)) };
    const store = new MongoRackStore(racks as never, {} as never);
    const context = {} as never;

    await expect(
      store.saveRack(Rack.create({ id: 'rack-1', uCapacity: 42 }), context),
    ).resolves.toBe(4);

    expect(racks.findOneAndUpdate).toHaveBeenCalledWith(
      { id: 'rack-1' },
      {
        $set: { uCapacity: 42 },
        $setOnInsert: { id: 'rack-1' },
        $inc: { auditSequence: 1 },
        $unset: { rowLabel: '', positionInRow: '' },
      },
      expect.objectContaining({ upsert: true, new: true, session: context }),
    );
  });

  it('lists location history in effective-start order', async () => {
    const doc = {
      id: 'location-1',
      rackId: 'rack-1',
      roomId: 'room-1',
      column: 2,
      row: 3,
      rotation: 90 as const,
      validFrom: new Date('2026-01-01T00:00:00Z'),
    };
    const locationQuery = query([doc]);
    const locations = { find: jest.fn(() => locationQuery) };
    const store = new MongoRackStore({} as never, locations as never);

    await expect(store.listLocationHistory('rack-1')).resolves.toHaveLength(1);
    expect(locations.find).toHaveBeenCalledWith({ rackId: 'rack-1' });
    expect(locationQuery.sort).toHaveBeenCalledWith({ validFrom: 1, id: 1 });
  });
});

function query<TResult>(value: TResult) {
  const chain: {
    select: jest.Mock;
    sort: jest.Mock;
    session: jest.Mock;
    lean: jest.Mock;
    exec: jest.Mock;
  } = {} as never;
  Object.assign(chain, {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    session: jest.fn(() => chain),
    lean: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(value) })),
    exec: jest.fn().mockResolvedValue(value),
  });
  return chain;
}

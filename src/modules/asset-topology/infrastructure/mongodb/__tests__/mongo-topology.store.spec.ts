/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- Mongoose query doubles are cast to the model query return type. */
/* eslint-disable @typescript-eslint/unbound-method -- Jest matchers inspect mocked methods. */

import { DEFAULT_DATA_CENTER_ID } from '../../../domain/topology/data-center';
import { Room } from '../../../domain/topology/room';
import { RoomMap } from '../../../domain/topology/room-map';
import { Site } from '../../../domain/topology/site';
import { MongoTopologyStore } from '.././mongo-topology.store';
import type {
  MongoTopologyDataCenterModel,
  MongoTopologyRoomModel,
  MongoTopologySiteModel,
} from '.././mongo-topology.store';

describe('MongoTopologyStore', () => {
  const siteModel = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  } as unknown as jest.Mocked<MongoTopologySiteModel>;
  const roomModel = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  } as unknown as jest.Mocked<MongoTopologyRoomModel>;
  const dataCenterModel = {
    findOne: jest.fn(),
  } as unknown as jest.Mocked<MongoTopologyDataCenterModel>;
  let store: MongoTopologyStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new MongoTopologyStore(dataCenterModel, siteModel, roomModel);
  });

  it('loads the seeded Data Center by its stable identity', async () => {
    const record = { id: DEFAULT_DATA_CENTER_ID, name: 'Default Data Center' };
    dataCenterModel.findOne.mockReturnValue(query(record) as never);

    await expect(store.getDataCenter(DEFAULT_DATA_CENTER_ID)).resolves.toEqual(
      record,
    );
    expect(dataCenterModel.findOne).toHaveBeenCalledWith({ id: 'dc-default' });
  });

  it('maps persisted Site fields into an immutable domain reference', async () => {
    siteModel.findOne.mockReturnValue(
      query({
        id: 'site-1',
        name: 'Building A',
        dataCenterId: 'dc-default',
      }) as never,
    );

    const site = await store.getSite('site-1' as never);

    expect(site).toBeInstanceOf(Site);
    expect(site).toMatchObject({
      id: 'site-1',
      name: 'Building A',
      dataCenterId: 'dc-default',
    });
  });

  it('saves only mutable Site fields and allocates a sequence in the transaction', async () => {
    const site = Site.create({
      id: 'site-1' as never,
      name: 'Building B',
      dataCenterId: DEFAULT_DATA_CENTER_ID,
    });
    const context = {} as never;
    siteModel.findOneAndUpdate.mockReturnValue(
      query({ auditSequence: 3 }) as never,
    );

    await expect(store.saveSite(site, context)).resolves.toBe(3);

    expect(siteModel.findOneAndUpdate).toHaveBeenCalledWith(
      { id: 'site-1' },
      {
        $set: { name: 'Building B' },
        $setOnInsert: { id: 'site-1', dataCenterId: 'dc-default' },
        $inc: { auditSequence: 1 },
      },
      expect.objectContaining({
        upsert: true,
        new: true,
        setDefaultsOnInsert: false,
        session: context,
      }),
    );
  });

  it('maps persisted Room-map values and preserves the Site reference on save', async () => {
    roomModel.findOne.mockReturnValue(
      query({
        id: 'room-1',
        name: 'Server Room A',
        siteId: 'site-1',
        widthMm: 10_000,
        depthMm: 8_000,
        gridSnapMm: 100,
      }) as never,
    );
    const room = await store.getRoom('room-1' as never);
    expect(room).toBeInstanceOf(Room);
    expect(room?.roomMap).toEqual(
      RoomMap.create({ widthMm: 10_000, depthMm: 8_000, gridSnapMm: 100 }),
    );

    const updated = room!.update({
      name: 'Server Room B',
      roomMap: RoomMap.create({
        widthMm: 12_000,
        depthMm: 8_000,
        gridSnapMm: 100,
      }),
    });
    roomModel.findOneAndUpdate.mockReturnValue(
      query({ auditSequence: 2 }) as never,
    );
    await expect(store.saveRoom(updated, {} as never)).resolves.toBe(2);
    expect(roomModel.findOneAndUpdate).toHaveBeenCalledWith(
      { id: 'room-1' },
      {
        $set: {
          name: 'Server Room B',
          widthMm: 12_000,
          depthMm: 8_000,
          gridSnapMm: 100,
        },
        $setOnInsert: { id: 'room-1', siteId: 'site-1' },
        $inc: { auditSequence: 1 },
      },
      expect.objectContaining({
        upsert: true,
        new: true,
        setDefaultsOnInsert: false,
      }),
    );
  });
});

function query<TResult>(result: TResult) {
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
    lean: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(result) })),
    exec: jest.fn().mockResolvedValue(result),
  });
  return chain;
}

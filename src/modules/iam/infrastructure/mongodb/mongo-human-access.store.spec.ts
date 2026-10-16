import {
  MongoHumanAccessStore,
  type MongoHumanAccessModel,
} from './mongo-human-access.store';

describe('MongoHumanAccessStore', () => {
  /** Reads only public access fields and resolves the current effective permissions. */
  it('maps the persisted access record to IAM domain state', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({
        userId: 'user-1',
        role: 'TECHNICIAN',
        status: 'ACTIVE',
        additionalPermissions: [],
        presencePreference: 'AUTOMATIC',
      }),
    };
    const model: MongoHumanAccessModel = {
      findOne: jest.fn().mockReturnValue(query),
    };
    const store = new MongoHumanAccessStore(model);

    await expect(store.findByUserId('user-1')).resolves.toMatchObject({
      userId: 'user-1',
      status: 'ACTIVE',
      effectivePermissions: [
        'asset:read',
        'monitoring:read',
        'ticket:read',
        'maintenance:read',
        'maintenance:execute',
      ],
    });
    expect(query.select).toHaveBeenCalledWith(
      'userId role status additionalPermissions presencePreference',
    );
  });

  /** Returns null when the requested account no longer exists. */
  it('returns null for a missing account', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    };
    const store = new MongoHumanAccessStore({
      findOne: jest.fn().mockReturnValue(query),
    });

    await expect(store.findByUserId('missing')).resolves.toBeNull();
  });
});

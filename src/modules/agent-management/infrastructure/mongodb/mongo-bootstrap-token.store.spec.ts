import {
  BootstrapTokenIssuanceConflictError,
  MongoBootstrapTokenStore,
} from './mongo-bootstrap-token.store';

describe('MongoBootstrapTokenStore', () => {
  it('surfaces a unique-index race as an issuance conflict', async () => {
    const duplicate = { code: 11000 };
    const collection = {
      findOne: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn(),
      insertOne: jest.fn().mockRejectedValue(duplicate),
      countDocuments: jest.fn(),
    };
    const connection = {
      collection: jest.fn(() => collection),
    };
    const store = new MongoBootstrapTokenStore(connection as never);

    await expect(
      store.issue(
        {
          tokenId: 'bt_one',
          nodeId: 'node-1',
          tokenHash: 'hash',
          expiresAt: new Date(),
          createdBy: 'admin',
        },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(BootstrapTokenIssuanceConflictError);
  });

  it('checks the Agent owned binding collection through its persistence boundary', async () => {
    const countDocuments = jest.fn().mockResolvedValue(1);
    const connection = {
      collection: jest.fn(() => ({ countDocuments })),
    };
    const store = new MongoBootstrapTokenStore(connection as never);
    await expect(store.hasActiveBinding('node-1')).resolves.toBe(true);
    expect(countDocuments).toHaveBeenCalledWith({
      nodeId: 'node-1',
      status: 'active',
    });
  });
});

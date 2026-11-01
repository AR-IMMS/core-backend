import { BOOTSTRAP_TOKEN_INDEXES_MIGRATION } from '../bootstrap-token-indexes.migration';

describe('bootstrap token indexes migration', () => {
  it('creates unique issuance constraints and independent TTL cleanup', async () => {
    const createIndex = jest.fn().mockResolvedValue('created');
    const connection = {
      collection: jest.fn(() => ({ createIndex })),
    } as never;
    await BOOTSTRAP_TOKEN_INDEXES_MIGRATION.up(connection);
    expect(createIndex).toHaveBeenCalledWith(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'ttl_agent_bootstrap_expiry' },
    );
    expect(createIndex).toHaveBeenCalledWith(
      { nodeId: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { status: 'active' },
      }),
    );
  });
});

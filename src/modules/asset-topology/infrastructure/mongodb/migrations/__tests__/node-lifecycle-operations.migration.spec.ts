import { NODE_LIFECYCLE_OPERATIONS_MIGRATION } from '../node-lifecycle-operations.migration';

describe('NODE_LIFECYCLE_OPERATIONS_MIGRATION', () => {
  it('creates unique operation, idempotency, and active-Node indexes', async () => {
    const createIndex = jest.fn().mockResolvedValue('index');
    const connection = { db: { collection: () => ({ createIndex }) } };
    await NODE_LIFECYCLE_OPERATIONS_MIGRATION.up(connection as never);
    expect(createIndex).toHaveBeenCalledTimes(4);
    expect(createIndex).toHaveBeenCalledWith(
      { nodeId: 1 },
      expect.objectContaining({
        unique: true,
        name: 'uq_asset_topology_pending_lifecycle_node',
      }),
    );
  });
});

import { AGENT_REGISTRY_QUERY_INDEXES_MIGRATION } from '../agent-registry-query-indexes.migration';

describe('Agent Registry query indexes migration', () => {
  it('creates the installation-scoped descending binding history index', async () => {
    const indexes: Array<{
      collection: string;
      keys: object;
      options: object;
    }> = [];
    const connection = {
      collection: (collection: string) => ({
        createIndex: jest.fn((keys: object, options: object) => {
          indexes.push({ collection, keys, options });
          return Promise.resolve('index');
        }),
      }),
    };

    await AGENT_REGISTRY_QUERY_INDEXES_MIGRATION.up(connection as never);

    expect(indexes).toEqual([
      {
        collection: 'agent_management_bindings',
        keys: { installationId: 1, createdAt: -1, bindingId: -1 },
        options: { name: 'ix_agent_bindings_installation_history' },
      },
    ]);
  });
});

import { AGENT_ACCESS_INDEXES_MIGRATION } from '../agent-access-indexes.migration';

describe('AGENT_ACCESS_INDEXES_MIGRATION', () => {
  it('adds stable binding identity and binding-scoped credential lookup indexes', async () => {
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

    await AGENT_ACCESS_INDEXES_MIGRATION.up(connection as never);

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collection: 'agent_management_bindings',
          keys: { bindingId: 1 },
          options: {
            unique: true,
            name: 'uq_agent_binding_id',
          },
        }),
        expect.objectContaining({
          collection: 'agent_management_credentials',
          keys: { bindingId: 1, status: 1 },
          options: { name: 'ix_agent_credentials_by_binding_status' },
        }),
      ]),
    );
  });
});

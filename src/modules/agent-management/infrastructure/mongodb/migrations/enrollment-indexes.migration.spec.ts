import { ENROLLMENT_INDEXES_MIGRATION } from './enrollment-indexes.migration';

describe('ENROLLMENT_INDEXES_MIGRATION', () => {
  it('creates unique installation, active binding, credential and attempt indexes', async () => {
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
    await ENROLLMENT_INDEXES_MIGRATION.up(connection as never);
    expect(indexes).toHaveLength(5);
    expect(
      indexes.find(
        (index) => index.collection === 'agent_management_installations',
      )?.options,
    ).toMatchObject({ unique: true });
    expect(
      indexes.find((index) => index.collection === 'agent_management_bindings')
        ?.options,
    ).toMatchObject({
      unique: true,
      partialFilterExpression: { status: 'active' },
    });
    expect(
      indexes.find(
        (index) => index.collection === 'agent_management_enrollment_attempts',
      )?.options,
    ).toMatchObject({ unique: true });
  });
});

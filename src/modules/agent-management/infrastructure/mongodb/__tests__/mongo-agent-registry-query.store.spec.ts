import { MongoAgentRegistryQueryStore } from '../mongo-agent-registry-query.store';

describe('MongoAgentRegistryQueryStore', () => {
  it('projects installation and current binding fields without arbitrary metadata', async () => {
    const installationCollection = {
      findOne: jest.fn().mockResolvedValue({
        installationId: 'installation-1',
        agentVersion: '0.1.4',
        environment: { os: 'linux', architecture: 'amd64', hostname: 'host-1' },
        metadata: { api_key: 'must-not-be-read' },
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
        updatedAt: null,
      }),
    };
    const bindingCollection = {
      findOne: jest.fn().mockResolvedValue({
        bindingId: 'binding-1',
        installationId: 'installation-1',
        nodeId: 'node-1',
        status: 'active',
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
        revokedBy: 'must-not-be-read',
      }),
    };
    const store = createStore({
      agent_management_installations: installationCollection,
      agent_management_bindings: bindingCollection,
    });

    const result = await store.findInstallation('installation-1');

    expect(result).toEqual({
      installationId: 'installation-1',
      agentVersion: '0.1.4',
      environment: { os: 'linux', architecture: 'amd64', hostname: 'host-1' },
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      updatedAt: null,
      currentBinding: {
        bindingId: 'binding-1',
        nodeId: 'node-1',
        status: 'active',
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
      },
    });
    expect(installationCollection.findOne).toHaveBeenCalledWith(
      { installationId: 'installation-1' },
      {
        projection: {
          installationId: 1,
          agentVersion: 1,
          environment: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    );
    expect(bindingCollection.findOne).toHaveBeenCalledWith(
      { installationId: 'installation-1', status: 'active' },
      {
        projection: {
          bindingId: 1,
          installationId: 1,
          nodeId: 1,
          status: 1,
          createdAt: 1,
        },
      },
    );
  });

  it('uses stable descending keyset pagination for binding history', async () => {
    const createdAt = new Date('2026-11-01T10:00:00.000Z');
    const cursor = {
      createdAt,
      bindingId: 'c4d9584e-6cf8-46d9-b10b-034a5dfd68a7',
    };
    const toArray = jest.fn().mockResolvedValue([
      {
        bindingId: 'a4d9584e-6cf8-46d9-b10b-034a5dfd68a7',
        nodeId: 'node-1',
        status: 'revoked',
        createdAt,
        revokedAt: new Date('2026-11-02T10:00:00.000Z'),
        revokedBy: 'must-not-be-read',
      },
    ]);
    const cursorQuery = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray,
    };
    const installationCollection = {
      findOne: jest
        .fn()
        .mockResolvedValue({ installationId: 'installation-1' }),
    };
    const bindingCollection = {
      find: jest.fn().mockReturnValue(cursorQuery),
    };
    const store = createStore({
      agent_management_installations: installationCollection,
      agent_management_bindings: bindingCollection,
    });

    const page = await store.listBindings({
      installationId: 'installation-1',
      pageSize: 1,
      after: cursor,
    });

    expect(bindingCollection.find).toHaveBeenCalledWith(
      {
        installationId: 'installation-1',
        $or: [
          { createdAt: { $lt: createdAt } },
          { createdAt, bindingId: { $lt: cursor.bindingId } },
        ],
      },
      {
        projection: {
          bindingId: 1,
          nodeId: 1,
          status: 1,
          createdAt: 1,
          revokedAt: 1,
        },
      },
    );
    expect(cursorQuery.sort).toHaveBeenCalledWith({
      createdAt: -1,
      bindingId: -1,
    });
    expect(cursorQuery.limit).toHaveBeenCalledWith(2);
    expect(page).toEqual({
      items: [
        {
          bindingId: 'a4d9584e-6cf8-46d9-b10b-034a5dfd68a7',
          nodeId: 'node-1',
          status: 'revoked',
          createdAt,
          revokedAt: new Date('2026-11-02T10:00:00.000Z'),
        },
      ],
      hasMore: false,
    });
  });

  it('rejects a revoked binding without its persisted revocation timestamp', async () => {
    const cursorQuery = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([
        {
          bindingId: 'a4d9584e-6cf8-46d9-b10b-034a5dfd68a7',
          nodeId: 'node-1',
          status: 'revoked',
          createdAt: new Date('2026-11-01T10:00:00.000Z'),
        },
      ]),
    };
    const store = createStore({
      agent_management_installations: {
        findOne: jest
          .fn()
          .mockResolvedValue({ installationId: 'installation-1' }),
      },
      agent_management_bindings: {
        find: jest.fn().mockReturnValue(cursorQuery),
      },
    });

    await expect(
      store.listBindings({ installationId: 'installation-1', pageSize: 20 }),
    ).rejects.toThrow('Agent Registry record is invalid');
  });
});

function createStore(
  collections: Record<string, object>,
): MongoAgentRegistryQueryStore {
  const connection = {
    collection: (name: string) => {
      const collection = collections[name];
      if (!collection) throw new Error(`Unexpected collection ${name}`);
      return collection;
    },
  };
  return new MongoAgentRegistryQueryStore(connection as never);
}

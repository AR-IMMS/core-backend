import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api';
import { PaginatedResult } from '@platform/http/api/pagination/paginated-result';
import { AgentRegistryController } from '../agent-registry.controller';
import {
  decodeInstallationCursor,
  encodeInstallationCursor,
} from '../agent-registry.cursor';

const INSTALLATION_ID = '5baf0cba-cf5a-4d39-a3d4-e76263b70810';
const NODE_ID = 'bb33fab0-c664-4a53-a813-72d7a2aac8c7';

describe('AgentRegistryController', () => {
  it('requires agent:manage for each read operation', () => {
    for (const method of ['list', 'get', 'bindings']) {
      const handler = getHandler(AgentRegistryController.prototype, method);
      expect(Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, handler)).toEqual({
        kind: 'permissions',
        permissions: ['agent:manage'],
      });
    }
  });

  it('parses the node filter and returns the standard cursor page', async () => {
    const list = {
      execute: jest
        .fn()
        .mockResolvedValue({ items: [], nextCursorInstallationId: null }),
    };
    const controller = new AgentRegistryController(
      list as never,
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
    );

    const result = await controller.list({
      node_id: NODE_ID,
      page_size: '20',
    } as never);

    expect(list.execute).toHaveBeenCalledWith({
      pageSize: 20,
      afterInstallationId: undefined,
      nodeId: NODE_ID,
    });
    expect(result).toBeInstanceOf(PaginatedResult);
    expect(result.pagination).toEqual({ type: 'cursor', next_cursor: null });
  });

  it('serializes only approved installation fields and omits metadata', async () => {
    const detail = {
      execute: jest.fn().mockResolvedValue({
        installationId: INSTALLATION_ID,
        agentVersion: '0.1.4',
        environment: { os: 'linux', architecture: 'amd64' },
        metadata: { api_key: 'must-not-be-returned' },
        createdAt: new Date('2026-11-01T10:00:00.000Z'),
        updatedAt: null,
        currentBinding: null,
      }),
    };
    const controller = new AgentRegistryController(
      { execute: jest.fn() } as never,
      detail as never,
      { execute: jest.fn() } as never,
    );

    await expect(
      controller.get({ installationId: INSTALLATION_ID }),
    ).resolves.toEqual({
      installation_id: INSTALLATION_ID,
      agent_version: '0.1.4',
      environment: { os: 'linux', architecture: 'amd64' },
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: null,
      current_binding: null,
    });
  });

  it('returns revoked binding history without revocation actor details', async () => {
    const revokedAt = new Date('2026-11-02T10:00:00.000Z');
    const history = {
      execute: jest.fn().mockResolvedValue({
        items: [
          {
            bindingId: 'binding-1',
            nodeId: NODE_ID,
            status: 'revoked',
            createdAt: new Date('2026-11-01T10:00:00.000Z'),
            revokedAt,
            revokedBy: 'admin-1',
          },
        ],
        nextCursor: null,
      }),
    };
    const controller = new AgentRegistryController(
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
      history as never,
    );

    const result = await controller.bindings(
      { installationId: INSTALLATION_ID },
      { page_size: 20 },
    );

    expect(result.items).toEqual([
      {
        binding_id: 'binding-1',
        node_id: NODE_ID,
        status: 'revoked',
        created_at: '2026-11-01T10:00:00.000Z',
        revoked_at: '2026-11-02T10:00:00.000Z',
      },
    ]);
    expect(result.pagination).toEqual({ type: 'cursor', next_cursor: null });
  });

  it('rejects malformed and oversized installation cursors', () => {
    expect(() => decodeInstallationCursor('%%%')).toThrow();
    expect(() => decodeInstallationCursor('a'.repeat(513))).toThrow();
    expect(
      decodeInstallationCursor(encodeInstallationCursor(INSTALLATION_ID)),
    ).toBe(INSTALLATION_ID);
  });
});

function getHandler(target: object, propertyKey: string): object {
  const value: unknown = Object.getOwnPropertyDescriptor(
    target,
    propertyKey,
  )?.value;
  if (typeof value !== 'function') throw new Error('Test handler is missing');
  return value;
}

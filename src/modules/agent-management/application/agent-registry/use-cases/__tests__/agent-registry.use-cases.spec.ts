import { GetAgentInstallationUseCase } from '../get-agent-installation.use-case';
import { ListAgentInstallationsUseCase } from '../list-agent-installations.use-case';
import { ListInstallationBindingsUseCase } from '../list-installation-bindings.use-case';

describe('Agent Registry query use cases', () => {
  it('forwards page and Node filter and returns a continuation installation ID', async () => {
    const query = {
      listInstallations: jest.fn().mockResolvedValue({
        items: [installation('install-1'), installation('install-2')],
        hasMore: true,
      }),
    };
    const useCase = new ListAgentInstallationsUseCase(query as never);

    await expect(
      useCase.execute({
        pageSize: 20,
        afterInstallationId: 'install-0',
        nodeId: 'node-1',
      }),
    ).resolves.toEqual({
      items: [installation('install-1'), installation('install-2')],
      nextCursorInstallationId: 'install-2',
    });
    expect(query.listInstallations).toHaveBeenCalledWith({
      pageSize: 20,
      afterInstallationId: 'install-0',
      nodeId: 'node-1',
    });
  });

  it('returns installation details with the active binding supplied by the query port', async () => {
    const view = installation('install-1', {
      bindingId: 'binding-1',
      nodeId: 'node-1',
      status: 'active',
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
    });
    const query = { findInstallation: jest.fn().mockResolvedValue(view) };
    const useCase = new GetAgentInstallationUseCase(query as never);

    await expect(useCase.execute('install-1')).resolves.toBe(view);
    expect(query.findInstallation).toHaveBeenCalledWith('install-1');
  });

  it('returns revoked binding history and a stable composite continuation cursor', async () => {
    const createdAt = new Date('2026-11-01T10:00:00.000Z');
    const binding = {
      bindingId: 'binding-1',
      nodeId: 'node-1',
      status: 'revoked' as const,
      createdAt,
      revokedAt: new Date('2026-11-02T10:00:00.000Z'),
    };
    const query = {
      listBindings: jest.fn().mockResolvedValue({
        items: [binding],
        hasMore: true,
      }),
    };
    const useCase = new ListInstallationBindingsUseCase(query as never);

    await expect(
      useCase.execute({ installationId: 'install-1', pageSize: 10 }),
    ).resolves.toEqual({
      items: [binding],
      nextCursor: { createdAt, bindingId: 'binding-1' },
    });
  });

  it('returns null for binding history when the installation does not exist', async () => {
    const query = { listBindings: jest.fn().mockResolvedValue(null) };
    const useCase = new ListInstallationBindingsUseCase(query as never);

    await expect(
      useCase.execute({ installationId: 'missing', pageSize: 20 }),
    ).resolves.toBeNull();
  });
});

function installation(
  installationId: string,
  currentBinding: {
    bindingId: string;
    nodeId: string;
    status: 'active';
    createdAt: Date;
  } | null = null,
) {
  return {
    installationId,
    agentVersion: '0.1.4',
    environment: { os: 'linux', architecture: 'amd64' },
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: null,
    currentBinding,
  };
}

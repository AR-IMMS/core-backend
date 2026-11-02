import type { AgentRegistryQueryPort } from '../ports/agent-registry-query.port';

export class ListAgentInstallationsUseCase {
  constructor(private readonly query: AgentRegistryQueryPort) {}

  async execute(input: {
    readonly pageSize: number;
    readonly afterInstallationId?: string;
    readonly nodeId?: string;
  }) {
    const page = await this.query.listInstallations(input);
    const last = page.items.at(-1);
    return {
      items: page.items,
      nextCursorInstallationId:
        page.hasMore && last ? last.installationId : null,
    };
  }
}

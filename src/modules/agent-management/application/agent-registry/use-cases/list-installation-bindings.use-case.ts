import type { AgentRegistryQueryPort } from '../ports/agent-registry-query.port';

export class ListInstallationBindingsUseCase {
  constructor(private readonly query: AgentRegistryQueryPort) {}

  async execute(input: {
    readonly installationId: string;
    readonly pageSize: number;
    readonly after?: {
      readonly createdAt: Date;
      readonly bindingId: string;
    };
  }) {
    const page = await this.query.listBindings(input);
    if (!page) return null;
    const last = page.items.at(-1);
    return {
      items: page.items,
      nextCursor:
        page.hasMore && last
          ? { createdAt: last.createdAt, bindingId: last.bindingId }
          : null,
    };
  }
}

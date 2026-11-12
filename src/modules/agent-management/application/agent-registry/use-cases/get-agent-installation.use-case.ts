import type { AgentRegistryQueryPort } from '../ports/agent-registry-query.port';

export class GetAgentInstallationUseCase {
  constructor(private readonly query: AgentRegistryQueryPort) {}

  execute(installationId: string) {
    return this.query.findInstallation(installationId);
  }
}

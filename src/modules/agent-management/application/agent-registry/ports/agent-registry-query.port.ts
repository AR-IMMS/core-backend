export interface AgentRegistryActiveBindingView {
  readonly bindingId: string;
  readonly nodeId: string;
  readonly status: 'active';
  readonly createdAt: Date;
}

export interface AgentRegistryInstallationView {
  readonly installationId: string;
  readonly agentVersion: string;
  readonly environment: {
    readonly os: string;
    readonly architecture: string;
    readonly hostname?: string;
  };
  readonly createdAt: Date;
  readonly updatedAt: Date | null;
  readonly currentBinding: AgentRegistryActiveBindingView | null;
}

export type AgentRegistryBindingHistoryView =
  | {
      readonly bindingId: string;
      readonly nodeId: string;
      readonly status: 'active';
      readonly createdAt: Date;
    }
  | {
      readonly bindingId: string;
      readonly nodeId: string;
      readonly status: 'revoked';
      readonly createdAt: Date;
      readonly revokedAt: Date;
    };

export interface AgentRegistryQueryPort {
  listInstallations(input: {
    readonly pageSize: number;
    readonly afterInstallationId?: string;
    readonly nodeId?: string;
  }): Promise<{
    readonly items: readonly AgentRegistryInstallationView[];
    readonly hasMore: boolean;
  }>;
  findInstallation(
    installationId: string,
  ): Promise<AgentRegistryInstallationView | null>;
  listBindings(input: {
    readonly installationId: string;
    readonly pageSize: number;
    readonly after?: {
      readonly createdAt: Date;
      readonly bindingId: string;
    };
  }): Promise<{
    readonly items: readonly AgentRegistryBindingHistoryView[];
    readonly hasMore: boolean;
  } | null>;
}

export const AGENT_REGISTRY_QUERY_PORT = Symbol('AGENT_REGISTRY_QUERY_PORT');

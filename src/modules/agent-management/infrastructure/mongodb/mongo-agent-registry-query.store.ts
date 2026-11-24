import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type {
  AgentRegistryActiveBindingView,
  AgentRegistryBindingHistoryView,
  AgentRegistryInstallationView,
  AgentRegistryQueryPort,
} from '../../application/agent-registry/ports/agent-registry-query.port';

const INSTALLATION_PROJECTION = {
  installationId: 1,
  agentVersion: 1,
  environment: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

const ACTIVE_BINDING_PROJECTION = {
  bindingId: 1,
  installationId: 1,
  nodeId: 1,
  status: 1,
  createdAt: 1,
} as const;

const HISTORY_BINDING_PROJECTION = {
  bindingId: 1,
  nodeId: 1,
  status: 1,
  createdAt: 1,
  revokedAt: 1,
} as const;

@Injectable()
export class MongoAgentRegistryQueryStore implements AgentRegistryQueryPort {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async listInstallations(input: {
    readonly pageSize: number;
    readonly afterInstallationId?: string;
    readonly nodeId?: string;
  }) {
    const filter: Record<string, unknown> = {};
    if (input.afterInstallationId) {
      filter['installationId'] = { $gt: input.afterInstallationId };
    }

    if (input.nodeId) {
      const activeBinding = (await this.connection
        .collection('agent_management_bindings')
        .findOne(
          { nodeId: input.nodeId, status: 'active' },
          { projection: { installationId: 1 } },
        )) as unknown;
      const installationId = isRecord(activeBinding)
        ? activeBinding['installationId']
        : undefined;
      if (typeof installationId !== 'string')
        return { items: [], hasMore: false };
      if (
        input.afterInstallationId &&
        installationId <= input.afterInstallationId
      ) {
        return { items: [], hasMore: false };
      }
      filter['installationId'] = installationId;
    }

    const found = parseDocuments(
      await this.connection
        .collection('agent_management_installations')
        .find(filter, { projection: INSTALLATION_PROJECTION })
        .sort({ installationId: 1 })
        .limit(input.pageSize + 1)
        .toArray(),
    );
    const hasMore = found.length > input.pageSize;
    const documents = found.slice(0, input.pageSize);
    const installationIds = documents
      .map((document) => document['installationId'])
      .filter((value): value is string => typeof value === 'string');
    const bindings = installationIds.length
      ? parseDocuments(
          await this.connection
            .collection('agent_management_bindings')
            .find(
              { installationId: { $in: installationIds }, status: 'active' },
              { projection: ACTIVE_BINDING_PROJECTION },
            )
            .toArray(),
        )
      : [];
    const bindingsByInstallation = new Map<
      string,
      AgentRegistryActiveBindingView
    >();
    for (const document of bindings) {
      if (typeof document['installationId'] !== 'string') {
        throw invalidRegistryRecord();
      }
      bindingsByInstallation.set(
        document['installationId'],
        toActiveBinding(document),
      );
    }

    return {
      items: documents.map((document) =>
        toInstallation(document, bindingsByInstallation),
      ),
      hasMore,
    };
  }

  async findInstallation(
    installationId: string,
  ): Promise<AgentRegistryInstallationView | null> {
    const document = (await this.connection
      .collection('agent_management_installations')
      .findOne(
        { installationId },
        { projection: INSTALLATION_PROJECTION },
      )) as unknown;
    if (!isRecord(document)) return null;
    const binding = (await this.connection
      .collection('agent_management_bindings')
      .findOne(
        { installationId, status: 'active' },
        { projection: ACTIVE_BINDING_PROJECTION },
      )) as unknown;
    const bindingMap = new Map<string, AgentRegistryActiveBindingView>();
    if (binding !== null && binding !== undefined) {
      if (!isRecord(binding)) throw invalidRegistryRecord();
      bindingMap.set(installationId, toActiveBinding(binding));
    }
    return toInstallation(document, bindingMap);
  }

  async listBindings(input: {
    readonly installationId: string;
    readonly pageSize: number;
    readonly after?: {
      readonly createdAt: Date;
      readonly bindingId: string;
    };
  }): Promise<{
    readonly items: readonly AgentRegistryBindingHistoryView[];
    readonly hasMore: boolean;
  } | null> {
    const installation = (await this.connection
      .collection('agent_management_installations')
      .findOne(
        { installationId: input.installationId },
        { projection: { installationId: 1 } },
      )) as unknown;
    if (!isRecord(installation)) return null;

    const filter: Record<string, unknown> = {
      installationId: input.installationId,
    };
    if (input.after) {
      filter['$or'] = [
        { createdAt: { $lt: input.after.createdAt } },
        {
          createdAt: input.after.createdAt,
          bindingId: { $lt: input.after.bindingId },
        },
      ];
    }

    const found = parseDocuments(
      await this.connection
        .collection('agent_management_bindings')
        .find(filter, { projection: HISTORY_BINDING_PROJECTION })
        .sort({ createdAt: -1, bindingId: -1 })
        .limit(input.pageSize + 1)
        .toArray(),
    );
    return {
      items: found.slice(0, input.pageSize).map(toHistoryBinding),
      hasMore: found.length > input.pageSize,
    };
  }
}

function toInstallation(
  document: Record<string, unknown>,
  bindingsByInstallation: ReadonlyMap<string, AgentRegistryActiveBindingView>,
): AgentRegistryInstallationView {
  const installationId = requireString(document['installationId']);
  const environment = document['environment'];
  if (!isRecord(environment)) throw invalidRegistryRecord();
  const os = requireString(environment['os']);
  const architecture = requireString(environment['architecture']);
  const hostname = environment['hostname'];
  if (hostname !== undefined && typeof hostname !== 'string') {
    throw invalidRegistryRecord();
  }
  const updatedAt = document['updatedAt'];
  if (
    updatedAt !== undefined &&
    updatedAt !== null &&
    !(updatedAt instanceof Date)
  ) {
    throw invalidRegistryRecord();
  }
  return {
    installationId,
    agentVersion: requireString(document['agentVersion']),
    environment: {
      os,
      architecture,
      ...(typeof hostname === 'string' ? { hostname } : {}),
    },
    createdAt: requireDate(document['createdAt']),
    updatedAt: updatedAt instanceof Date ? updatedAt : null,
    currentBinding: bindingsByInstallation.get(installationId) ?? null,
  };
}

function toActiveBinding(
  document: Record<string, unknown>,
): AgentRegistryActiveBindingView {
  if (document['status'] !== 'active') throw invalidRegistryRecord();
  return {
    bindingId: requireString(document['bindingId']),
    nodeId: requireString(document['nodeId']),
    status: 'active',
    createdAt: requireDate(document['createdAt']),
  };
}

function toHistoryBinding(
  document: Record<string, unknown>,
): AgentRegistryBindingHistoryView {
  const status = document['status'];
  if (status !== 'active' && status !== 'revoked') {
    throw invalidRegistryRecord();
  }
  const revokedAt = document['revokedAt'];
  const binding = {
    bindingId: requireString(document['bindingId']),
    nodeId: requireString(document['nodeId']),
    createdAt: requireDate(document['createdAt']),
  };
  if (status === 'active') return { ...binding, status };
  if (!(revokedAt instanceof Date)) throw invalidRegistryRecord();
  return { ...binding, status, revokedAt };
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') throw invalidRegistryRecord();
  return value;
}

function requireDate(value: unknown): Date {
  if (!(value instanceof Date)) throw invalidRegistryRecord();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseDocuments(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw invalidRegistryRecord();
  }
  return value;
}

function invalidRegistryRecord(): Error {
  return new Error('Agent Registry record is invalid');
}

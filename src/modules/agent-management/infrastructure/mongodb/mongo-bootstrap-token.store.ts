import { InjectConnection } from '@nestjs/mongoose';
import { Injectable } from '@nestjs/common';
import type { Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import type { BootstrapTokenStorePort } from '../../application/bootstrap-token.port';

@Injectable()
export class MongoBootstrapTokenStore implements BootstrapTokenStorePort {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async hasActiveBinding(nodeId: string): Promise<boolean> {
    const count = await this.connection
      .collection('agent_management_bindings')
      .countDocuments({
        nodeId,
        status: 'active',
      });
    return count > 0;
  }

  async issue(
    input: {
      readonly tokenId: string;
      readonly nodeId: string;
      readonly tokenHash: string;
      readonly expiresAt: Date;
      readonly createdBy: string;
    },
    context: UnitOfWorkContext,
  ): Promise<void> {
    const session = context as unknown as import('mongoose').ClientSession;
    const tokens = this.connection.collection(
      'agent_management_bootstrap_tokens',
    );
    try {
      const activeBinding = await this.connection
        .collection('agent_management_bindings')
        .findOne({ nodeId: input.nodeId, status: 'active' }, { session });
      if (activeBinding) throw new ActiveAgentBindingError();
      const now = new Date();
      await tokens.updateMany(
        { nodeId: input.nodeId, status: 'active' },
        { $set: { invalidatedAt: now, status: 'invalidated' } },
        { session },
      );
      await tokens.insertOne(
        { ...input, status: 'active', createdAt: now },
        { session },
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new BootstrapTokenIssuanceConflictError();
      }
      throw error;
    }
  }
}

export class ActiveAgentBindingError extends Error {
  constructor() {
    super('Node already has an active Agent binding');
    this.name = 'ActiveAgentBindingError';
  }
}

export class BootstrapTokenIssuanceConflictError extends Error {
  constructor() {
    super('Bootstrap token issuance conflicts with a concurrent operation');
    this.name = 'BootstrapTokenIssuanceConflictError';
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

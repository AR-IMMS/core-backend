import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { ClientSession, Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import type {
  AgentAccessPersistencePort,
  AgentPrincipal,
} from '../../application/agent-access.port';

@Injectable()
export class MongoAgentAccessStore implements AgentAccessPersistencePort {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async findActivePrincipalByCredentialHash(
    credentialHash: string,
  ): Promise<AgentPrincipal | null> {
    const credential = await this.connection
      .collection('agent_management_credentials')
      .findOne({ credentialHash, status: 'active' });
    if (typeof credential?.['bindingId'] !== 'string') return null;

    const binding = await this.connection
      .collection('agent_management_bindings')
      .findOne({ bindingId: credential['bindingId'], status: 'active' });
    if (
      !binding ||
      typeof binding['bindingId'] !== 'string' ||
      typeof binding['installationId'] !== 'string' ||
      typeof binding['nodeId'] !== 'string'
    ) {
      return null;
    }

    const installation = await this.connection
      .collection('agent_management_installations')
      .findOne({ installationId: binding['installationId'] });
    if (!installation) return null;

    return {
      installationId: binding['installationId'],
      bindingId: binding['bindingId'],
      nodeId: binding['nodeId'],
    };
  }

  async revokeBinding(
    bindingId: string,
    actorId: string,
    revokedAt: Date,
    context: UnitOfWorkContext,
  ): Promise<'revoked' | 'already-revoked' | 'not-found'> {
    const session = context as unknown as ClientSession;
    const bindings = this.connection.collection('agent_management_bindings');
    const updated = await bindings.updateOne(
      { bindingId, status: 'active' },
      {
        $set: { status: 'revoked', revokedAt, revokedBy: actorId },
      },
      { session },
    );
    if (updated.modifiedCount !== 1) {
      const current = await bindings.findOne(
        { bindingId },
        { session, projection: { status: 1 } },
      );
      return current ? 'already-revoked' : 'not-found';
    }

    await this.connection
      .collection('agent_management_credentials')
      .updateMany(
        { bindingId, status: 'active' },
        { $set: { status: 'revoked', revokedAt } },
        { session },
      );
    return 'revoked';
  }
}

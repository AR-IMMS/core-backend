import { randomUUID } from 'node:crypto';
import type {
  AuditFactV2,
  OutboxWriterPort,
  UnitOfWorkPort,
} from '@platform/events';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION_V2,
} from '@platform/events';
import type { AgentAccessPersistencePort } from './agent-access.port';
import {
  AgentBindingNotFoundError,
  AgentBindingRevocationUnavailableError,
} from './agent-access.port';

export class RevokeAgentBindingUseCase {
  constructor(
    private readonly persistence: AgentAccessPersistencePort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly outbox: OutboxWriterPort,
    private readonly now: () => Date = () => new Date(),
    private readonly generateId: () => string = randomUUID,
  ) {}

  async execute(input: {
    readonly bindingId: string;
    readonly actorId: string;
  }) {
    const revokedAt = this.now();
    let result: Awaited<
      ReturnType<AgentAccessPersistencePort['revokeBinding']>
    >;
    try {
      result = await this.unitOfWork.run(async (context) => {
        const outcome = await this.persistence.revokeBinding(
          input.bindingId,
          input.actorId,
          revokedAt,
          context,
        );
        if (outcome === 'revoked') {
          await this.outbox.append(this.auditFact(input, revokedAt), context);
        }
        return outcome;
      });
    } catch {
      throw new AgentBindingRevocationUnavailableError();
    }

    if (result === 'not-found') throw new AgentBindingNotFoundError();
  }

  private auditFact(
    input: { readonly bindingId: string; readonly actorId: string },
    revokedAt: Date,
  ): AuditFactV2 {
    return {
      event_id: this.generateId(),
      event_type: AUDIT_FACT_EVENT_TYPE,
      event_version: AUDIT_FACT_EVENT_VERSION_V2,
      producer: 'agent-management',
      occurred_at: revokedAt.toISOString(),
      resource: {
        type: 'agent-management.binding',
        id: input.bindingId,
        sequence: 1,
      },
      payload: {
        actor: { type: 'user', id: input.actorId },
        action: 'agent_management.agent_binding.revoked',
        changes: [
          { field: 'status', before: 'active', after: 'revoked' },
          { field: 'revoked_at', after: revokedAt.toISOString() },
        ],
      },
      context: {},
    };
  }
}

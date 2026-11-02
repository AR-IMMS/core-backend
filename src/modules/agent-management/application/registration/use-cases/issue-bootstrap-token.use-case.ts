import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  AuditFactV2,
  OutboxWriterPort,
  UnitOfWorkPort,
} from '@platform/events';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION_V2,
} from '@platform/events';
import type {
  BootstrapTokenStorePort,
  NodeEligibilityPort,
} from '../ports/bootstrap-token.port';
import {
  AgentNodeNotEligibleError,
  AgentNodeNotFoundError,
} from '../../../domain/errors/registration.errors';

export class IssueBootstrapTokenUseCase {
  constructor(
    private readonly nodes: NodeEligibilityPort,
    private readonly tokens: BootstrapTokenStorePort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly outbox: OutboxWriterPort,
    private readonly now: () => Date = () => new Date(),
    private readonly generateSecret: () => Buffer = () => randomBytes(32),
    private readonly generateId: () => string = randomUUID,
  ) {}

  async execute(input: { nodeId: string; createdBy: string }) {
    const eligibility = await this.nodes.getEligibility(input.nodeId);
    if (!eligibility.exists) throw new AgentNodeNotFoundError();
    if (!eligibility.active || !eligibility.hasActivePlacement) {
      throw new AgentNodeNotEligibleError();
    }
    if (await this.tokens.hasActiveBinding(input.nodeId)) {
      throw new AgentNodeNotEligibleError();
    }

    const tokenId = `bt_${this.generateId()}`;
    const secret = `arimms_bt_${this.generateSecret().toString('base64url')}`;
    const expiresAt = new Date(this.now().getTime() + 10 * 60 * 1000);
    await this.unitOfWork.run(async (context) => {
      await this.tokens.issue(
        {
          tokenId,
          nodeId: input.nodeId,
          tokenHash: createHash('sha256').update(secret).digest('hex'),
          expiresAt,
          createdBy: input.createdBy,
        },
        context,
      );
      await this.outbox.append(
        this.auditFact(input, tokenId, expiresAt),
        context,
      );
    });
    return { tokenId, bootstrapToken: secret, nodeId: input.nodeId, expiresAt };
  }

  private auditFact(
    input: { nodeId: string; createdBy: string },
    tokenId: string,
    expiresAt: Date,
  ): AuditFactV2 {
    return {
      event_id: this.generateId(),
      event_type: AUDIT_FACT_EVENT_TYPE,
      event_version: AUDIT_FACT_EVENT_VERSION_V2,
      producer: 'agent-management',
      occurred_at: this.now().toISOString(),
      resource: {
        type: 'agent-management.bootstrap-token',
        id: tokenId,
        sequence: 1,
      },
      payload: {
        actor: { type: 'user', id: input.createdBy },
        action: 'agent_management.bootstrap_token.issued',
        changes: [
          { field: 'node_id', after: input.nodeId },
          { field: 'expires_at', after: expiresAt.toISOString() },
        ],
      },
      context: {},
    };
  }
}

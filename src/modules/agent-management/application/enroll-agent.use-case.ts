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
import type { NodeEligibilityPort } from './bootstrap-token.port';
import type {
  EnrollmentInput,
  EnrollmentPersistencePort,
} from './enrollment.port';
import {
  AgentNodeNotEligibleError,
  BootstrapTokenConsumedError,
  BootstrapTokenExpiredError,
  BootstrapTokenInvalidError,
  NodeAlreadyBoundError,
} from './enrollment.port';

export class EnrollAgentUseCase {
  constructor(
    private readonly persistence: EnrollmentPersistencePort,
    private readonly nodes: NodeEligibilityPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly outbox: OutboxWriterPort,
    private readonly controlPlaneBaseUrl: string,
    private readonly now: () => Date = () => new Date(),
    private readonly generateSecret: () => Buffer = () => randomBytes(32),
    private readonly generateId: () => string = randomUUID,
  ) {}

  async execute(input: EnrollmentInput) {
    const now = this.now();
    const tokenHash = hash(input.bootstrapToken);
    const token = await this.persistence.findToken(tokenHash);
    if (!token) throw new BootstrapTokenInvalidError();
    if (token.status === 'consumed') throw new BootstrapTokenConsumedError();
    if (token.status !== 'active') throw new BootstrapTokenInvalidError();
    if (token.expiresAt.getTime() <= now.getTime()) {
      throw new BootstrapTokenExpiredError();
    }

    const eligibility = await this.nodes.getEligibility(token.nodeId);
    if (
      !eligibility.exists ||
      !eligibility.active ||
      !eligibility.hasActivePlacement
    ) {
      throw new AgentNodeNotEligibleError();
    }
    if (await this.persistence.hasActiveBinding(token.nodeId)) {
      throw new NodeAlreadyBoundError();
    }

    const accessToken = `arimms_ac_${this.generateSecret().toString('base64url')}`;
    const enrollmentId = this.generateId();
    const bindingId = this.generateId();
    const credentialId = this.generateId();
    const requestFingerprint = fingerprint(input);
    const metadata = input.metadata ?? {};

    await this.unitOfWork.run(async (context) => {
      if (
        !(await this.nodes.serializeEnrollmentEligibility(
          token.nodeId,
          context,
        ))
      ) {
        throw new AgentNodeNotEligibleError();
      }
      if (await this.persistence.hasActiveBinding(token.nodeId, context)) {
        throw new NodeAlreadyBoundError();
      }
      await this.persistence.enroll(
        {
          tokenHash,
          now,
          attemptId: input.attemptId,
          requestFingerprint,
          installationId: input.installation.id,
          enrollmentId,
          agentVersion: input.agent.version,
          environment: input.environment,
          metadata,
          bindingId,
          credentialId,
          credentialHash: hash(accessToken),
        },
        context,
      );
      await this.outbox.append(
        this.auditFact(token.nodeId, enrollmentId, input),
        context,
      );
    });

    return {
      enrollmentId,
      installationId: input.installation.id,
      binding: {
        id: bindingId,
        nodeId: token.nodeId,
        status: 'active' as const,
      },
      accessToken,
      controlPlane: {
        baseUrl: this.controlPlaneBaseUrl,
        pollIntervalSeconds: 30,
      },
    };
  }

  private auditFact(
    nodeId: string,
    enrollmentId: string,
    input: EnrollmentInput,
  ): AuditFactV2 {
    return {
      event_id: this.generateId(),
      event_type: AUDIT_FACT_EVENT_TYPE,
      event_version: AUDIT_FACT_EVENT_VERSION_V2,
      producer: 'agent-management',
      occurred_at: this.now().toISOString(),
      resource: {
        type: 'agent-management.enrollment',
        id: enrollmentId,
        sequence: 1,
      },
      payload: {
        actor: { type: 'agent', id: input.installation.id },
        action: 'agent_management.agent.enrolled',
        changes: [
          { field: 'node_id', after: nodeId },
          { field: 'installation_id', after: input.installation.id },
          { field: 'agent_version', after: input.agent.version },
        ],
      },
      context: {},
    };
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fingerprint(input: EnrollmentInput): string {
  const canonical = canonicalize({
    bootstrapTokenHash: hash(input.bootstrapToken),
    installation: input.installation,
    agent: input.agent,
    environment: input.environment,
    metadata: input.metadata ?? {},
  });
  return hash(JSON.stringify(canonical));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

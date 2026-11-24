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
import type { NodeEligibilityPort } from '../ports/bootstrap-token.port';
import type { EnrollmentPersistencePort } from '../ports/enrollment.port';
import type { EnrollmentInput } from '../enrollment-input';
import {
  AgentNodeNotEligibleError,
  BootstrapTokenConsumedError,
  BootstrapTokenExpiredError,
  BootstrapTokenInvalidError,
  EnrollmentAttemptConflictError,
  EnrollmentRecoveryExpiredError,
  EnrollmentRecoveryRevokedError,
  NodeAlreadyBoundError,
} from '../../../domain/errors/registration.errors';
import { EnrollmentRecoveryUnavailableError } from '../errors/enrollment-availability.errors';
import type { EnrollmentRecoveryCipherPort } from '../ports/enrollment-recovery.port';

const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export class EnrollAgentUseCase {
  constructor(
    private readonly persistence: EnrollmentPersistencePort,
    private readonly nodes: NodeEligibilityPort,
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly outbox: OutboxWriterPort,
    private readonly controlPlaneBaseUrl: string,
    private readonly recoveryCipher: EnrollmentRecoveryCipherPort,
    private readonly now: () => Date = () => new Date(),
    private readonly generateSecret: () => Buffer = () => randomBytes(32),
    private readonly generateId: () => string = randomUUID,
  ) {}

  async execute(input: EnrollmentInput) {
    const now = this.now();
    const tokenHash = hash(input.bootstrapToken);
    const requestFingerprint = fingerprint(input);
    const existingAttempt = await this.readAttempt(input.attemptId);
    if (existingAttempt) {
      return this.recover(
        existingAttempt,
        input.attemptId,
        requestFingerprint,
        now,
      );
    }

    const token = await this.persistence.findToken(tokenHash);
    if (!token) {
      return this.recoverAfterRace(
        new BootstrapTokenInvalidError(),
        input.attemptId,
        requestFingerprint,
        now,
      );
    }
    if (token.status === 'consumed') {
      return this.recoverAfterRace(
        new BootstrapTokenConsumedError(),
        input.attemptId,
        requestFingerprint,
        now,
      );
    }
    if (token.status !== 'active') {
      return this.recoverAfterRace(
        new BootstrapTokenInvalidError(),
        input.attemptId,
        requestFingerprint,
        now,
      );
    }
    if (token.expiresAt.getTime() <= now.getTime()) {
      return this.recoverAfterRace(
        new BootstrapTokenExpiredError(),
        input.attemptId,
        requestFingerprint,
        now,
      );
    }

    const eligibility = await this.nodes.getEligibility(token.nodeId);
    if (
      !eligibility.exists ||
      !eligibility.active ||
      !eligibility.hasActivePlacement
    ) {
      return this.recoverAfterRace(
        new AgentNodeNotEligibleError(),
        input.attemptId,
        requestFingerprint,
        now,
      );
    }
    if (await this.persistence.hasActiveBinding(token.nodeId)) {
      return this.recoverAfterRace(
        new NodeAlreadyBoundError(),
        input.attemptId,
        requestFingerprint,
        now,
      );
    }

    const accessToken = `arimms_ac_${this.generateSecret().toString('base64url')}`;
    const enrollmentId = this.generateId();
    const bindingId = this.generateId();
    const credentialId = this.generateId();
    const metadata = input.metadata ?? {};
    const result = {
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
    const encryptedResult = this.recoveryCipher.encrypt(
      JSON.stringify(result),
      recoveryAdditionalData(input.attemptId, requestFingerprint),
    );

    try {
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
            recoveryExpiresAt: new Date(now.getTime() + RECOVERY_WINDOW_MS),
            encryptedResult,
          },
          context,
        );
        await this.outbox.append(
          this.auditFact(token.nodeId, enrollmentId, input),
          context,
        );
      });
    } catch (error) {
      return this.recoverAfterRace(
        error,
        input.attemptId,
        requestFingerprint,
        now,
      );
    }

    return { ...result, recovered: false };
  }

  private async recoverAfterRace(
    originalError: unknown,
    attemptId: string,
    requestFingerprint: string,
    now: Date,
  ) {
    const attempt = await this.readAttempt(attemptId);
    if (!attempt) throw originalError;
    return this.recover(attempt, attemptId, requestFingerprint, now);
  }

  private async readAttempt(attemptId: string) {
    try {
      return await this.persistence.findAttempt(attemptId);
    } catch {
      throw new EnrollmentRecoveryUnavailableError();
    }
  }

  private async recover(
    attempt: {
      readonly requestFingerprint: string;
      readonly status: string;
      readonly committedAt: Date;
      readonly bindingId: string;
      readonly installationId: string;
    },
    attemptId: string,
    requestFingerprint: string,
    now: Date,
  ) {
    if (attempt.requestFingerprint !== requestFingerprint) {
      throw new EnrollmentAttemptConflictError();
    }
    if (attempt.status !== 'committed') {
      throw new EnrollmentRecoveryUnavailableError();
    }
    await this.ensureRecoveryActive(attemptId, attempt);

    let recovery: Awaited<
      ReturnType<EnrollmentPersistencePort['findRecovery']>
    >;
    try {
      recovery = await this.persistence.findRecovery(attemptId);
    } catch {
      throw new EnrollmentRecoveryUnavailableError();
    }
    if (!recovery || recovery.expiresAt.getTime() <= now.getTime()) {
      throw new EnrollmentRecoveryExpiredError();
    }
    if (recovery.requestFingerprint !== attempt.requestFingerprint) {
      throw new EnrollmentRecoveryUnavailableError();
    }

    let result: unknown;
    try {
      result = JSON.parse(
        this.recoveryCipher.decrypt(
          recovery.encryptedResult,
          recoveryAdditionalData(attemptId, requestFingerprint),
        ),
      );
      if (!isEnrollmentResult(result)) {
        throw new EnrollmentRecoveryUnavailableError();
      }
    } catch {
      throw new EnrollmentRecoveryUnavailableError();
    }

    await this.ensureRecoveryActive(attemptId, attempt);
    if (
      !isEnrollmentResult(result) ||
      result.binding.id !== attempt.bindingId ||
      result.installationId !== attempt.installationId
    ) {
      throw new EnrollmentRecoveryUnavailableError();
    }
    return { ...result, recovered: true };
  }

  private async ensureRecoveryActive(
    attemptId: string,
    attempt: { readonly bindingId: string; readonly installationId: string },
  ): Promise<void> {
    let active: boolean;
    try {
      active = await this.persistence.isEnrollmentResultActive({
        attemptId,
        bindingId: attempt.bindingId,
        installationId: attempt.installationId,
      });
    } catch {
      throw new EnrollmentRecoveryUnavailableError();
    }
    if (!active) throw new EnrollmentRecoveryRevokedError();
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

function recoveryAdditionalData(
  attemptId: string,
  fingerprint: string,
): string {
  return `${attemptId}:${fingerprint}`;
}

function isEnrollmentResult(value: unknown): value is {
  enrollmentId: string;
  installationId: string;
  binding: { id: string; nodeId: string; status: 'active' };
  accessToken: string;
  controlPlane: { baseUrl: string; pollIntervalSeconds: number };
} {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  if (
    typeof result['enrollmentId'] !== 'string' ||
    typeof result['installationId'] !== 'string' ||
    typeof result['accessToken'] !== 'string' ||
    typeof result['binding'] !== 'object' ||
    result['binding'] === null ||
    typeof result['controlPlane'] !== 'object' ||
    result['controlPlane'] === null
  ) {
    return false;
  }
  const binding = result['binding'] as Record<string, unknown>;
  const controlPlane = result['controlPlane'] as Record<string, unknown>;
  return (
    typeof binding['id'] === 'string' &&
    typeof binding['nodeId'] === 'string' &&
    binding['status'] === 'active' &&
    typeof controlPlane['baseUrl'] === 'string' &&
    typeof controlPlane['pollIntervalSeconds'] === 'number'
  );
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

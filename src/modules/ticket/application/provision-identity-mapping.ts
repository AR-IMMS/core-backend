import { randomUUID } from 'node:crypto';
import type { HumanAccessPort } from '@modules/iam';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION,
  type AuditFact,
  type OutboxWriterPort,
  type UnitOfWorkPort,
  type UnitOfWorkContext,
} from '@platform/events';
import {
  validateCoreUserId,
  validateIdentityMapping,
  validateMappingScope,
  type IdentityMapping,
  type MappingScope,
} from '../domain/identity-mapping';
import type { ExternalUserAccessPort } from './external-user-access.port';
export interface ProvisionMappingRequest extends MappingScope {
  readonly actorUserId: string;
  readonly coreUserId: string;
  readonly zammadUserId: number;
}
/** Trusted operational boundary must verify authentication and explicit approval of this exact pair/scope.
 * No production grant provider exists until the provisioning procedure is approved.
 */
export interface MappingProvisioningAuthorityPort {
  authorize(request: ProvisionMappingRequest): Promise<{
    readonly actorUserId: string;
    readonly approvalReference: string;
  } | null>;
}
export interface IdentityMappingWritePort {
  insert(mapping: IdentityMapping, context: UnitOfWorkContext): Promise<void>;
}
export class MappingProvisioningError extends Error {
  constructor(
    readonly code:
      'DENIED' | 'INVALID_REQUEST' | 'CONFLICT' | 'DEPENDENCY_FAILURE',
  ) {
    super(`Mapping provisioning failed: ${code}`);
  }
}
/** Internal create-only operation. No email lookup, rebind, reactivation, CLI or HTTP endpoint. */
export class ProvisionIdentityMapping {
  private readonly scope: MappingScope;
  constructor(
    private readonly iam: HumanAccessPort,
    private readonly authority: MappingProvisioningAuthorityPort,
    private readonly external: ExternalUserAccessPort,
    private readonly mappings: IdentityMappingWritePort,
    private readonly uow: UnitOfWorkPort,
    private readonly outbox: OutboxWriterPort,
    scope: MappingScope,
  ) {
    validateMappingScope(scope);
    this.scope = Object.freeze({ ...scope });
  }
  async execute(input: ProvisionMappingRequest): Promise<IdentityMapping> {
    const request = Object.freeze({ ...input });
    try {
      validateMappingScope(request);
      validateCoreUserId(request.actorUserId);
      validateCoreUserId(request.coreUserId);
    } catch {
      throw new MappingProvisioningError('INVALID_REQUEST');
    }
    if (
      !Number.isSafeInteger(request.zammadUserId) ||
      request.zammadUserId <= 0
    )
      throw new MappingProvisioningError('INVALID_REQUEST');
    if (
      request.instanceKey !== this.scope.instanceKey ||
      request.approvedGroupId !== this.scope.approvedGroupId
    )
      throw new MappingProvisioningError('DENIED');
    try {
      await this.checkIam(request);
      const grant = await this.authority.authorize(request);
      if (
        !grant ||
        grant.actorUserId !== request.actorUserId ||
        !grant.approvalReference.trim() ||
        grant.approvalReference.length > 512
      )
        throw new MappingProvisioningError('DENIED');
      const eligible = await this.external.getEligibleHuman(
        request.zammadUserId,
      );
      if (
        !eligible ||
        eligible.externalUserId !== request.zammadUserId ||
        eligible.groupId !== request.approvedGroupId
      )
        throw new MappingProvisioningError('DENIED');
      // Revalidate after external I/O. These are per-operation snapshots, not distributed locks.
      await this.checkIam(request);
      const confirmed = await this.authority.authorize(request);
      if (
        !confirmed ||
        confirmed.actorUserId !== grant.actorUserId ||
        confirmed.approvalReference !== grant.approvalReference
      )
        throw new MappingProvisioningError('DENIED');
      const now = new Date();
      const mapping = validateIdentityMapping({
        instanceKey: request.instanceKey,
        coreUserId: request.coreUserId,
        zammadUserId: request.zammadUserId,
        approvedGroupId: request.approvedGroupId,
        status: 'ACTIVE',
        revision: 1,
        approvedByCoreUserId: grant.actorUserId,
        approvalReference: grant.approvalReference,
        validatedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const fact: AuditFact = {
        event_id: randomUUID(),
        event_type: AUDIT_FACT_EVENT_TYPE,
        event_version: AUDIT_FACT_EVENT_VERSION,
        producer: 'ticket',
        occurred_at: now.toISOString(),
        resource: {
          type: 'ticket.identity_mapping',
          id: JSON.stringify([mapping.instanceKey, mapping.coreUserId]),
          sequence: 1,
        },
        payload: {
          actor: { type: 'user', id: grant.actorUserId },
          action: 'ticket.identity_mapping.created',
          changes: [
            { field: 'zammad_user_id', after: mapping.zammadUserId },
            { field: 'group_id', after: mapping.approvedGroupId },
            { field: 'status', after: 'ACTIVE' },
            { field: 'approval_reference', after: grant.approvalReference },
          ],
        },
        context: {},
      };
      await this.uow.run(async (context) => {
        await this.mappings.insert(mapping, context);
        await this.outbox.append(fact, context);
      });
      return mapping;
    } catch (error) {
      if (error instanceof MappingProvisioningError) throw error;
      throw new MappingProvisioningError('DEPENDENCY_FAILURE');
    }
  }
  private async checkIam(request: ProvisionMappingRequest) {
    const actor = await this.iam.getPrincipal(request.actorUserId);
    if (
      !actor ||
      actor.userId !== request.actorUserId ||
      actor.role !== 'IT_ADMIN' ||
      actor.status !== 'ACTIVE' ||
      !(await this.iam.hasAllPermissions(actor.userId, ['user:manage']))
    )
      throw new MappingProvisioningError('DENIED');
    const target = await this.iam.getPrincipal(request.coreUserId);
    if (
      !target ||
      target.userId !== request.coreUserId ||
      target.status !== 'ACTIVE' ||
      !['OPERATOR', 'TECHNICIAN'].includes(target.role) ||
      !(await this.iam.hasAllPermissions(target.userId, ['ticket:read']))
    )
      throw new MappingProvisioningError('DENIED');
  }
}

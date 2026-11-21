import type { HumanAccessPort } from '@modules/iam';
import {
  IdentityMappingError,
  validateCoreUserId,
  validateIdentityMapping,
  validateMappingScope,
  type IdentityMapping,
  type MappingScope,
} from '../domain/identity-mapping';
import {
  ExternalUserAccessError,
  type ExternalUserAccessPort,
} from './external-user-access.port';
import type { IdentityMappingReadPort } from './identity-mapping-read.port';
import {
  TicketReadError,
  type ExternalTicket,
  type TicketReadPort,
} from './ticket-read.port';

export type TicketAccessResult =
  | {
      readonly status: 'allowed';
      readonly ticket: ExternalTicket;
      readonly businessOwnerStatus: 'valid' | 'missing' | 'invalid';
    }
  | { readonly status: 'denied' | 'not_found' };
export class TicketAuthorizationError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'DEPENDENCY_FAILURE') {
    super(`Ticket authorization failed: ${code}`);
  }
}
/** Internal query only. authenticatedUserId must originate from a trusted authenticated
 * entry point, never an unauthenticated client-selected ID. No cross-request cache or writes.
 */
export class GetAuthorizedTicket {
  private readonly scope: MappingScope;
  constructor(
    private readonly iam: HumanAccessPort,
    private readonly mappings: IdentityMappingReadPort,
    private readonly external: ExternalUserAccessPort,
    private readonly tickets: TicketReadPort,
    scope: MappingScope,
  ) {
    validateMappingScope(scope);
    this.scope = Object.freeze({ ...scope });
  }
  async execute(
    authenticatedUserId: string,
    ticketId: number,
  ): Promise<TicketAccessResult> {
    try {
      validateCoreUserId(authenticatedUserId);
      if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error();
    } catch {
      throw new TicketAuthorizationError('INVALID_REQUEST');
    }
    try {
      const authorized = await this.authorizeActor(authenticatedUserId);
      if (!authorized) return { status: 'denied' };
      const { actor, mapping } = authorized;
      const ticket = await this.tickets.getTicket(ticketId);
      if (!ticket) return { status: 'not_found' };
      if (ticket.externalTicketId !== ticketId)
        throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
      if (ticket.groupId !== this.scope.approvedGroupId)
        return { status: 'denied' };
      const owner = ticket.businessOwner;
      let ownerStatus: 'valid' | 'missing' | 'invalid' =
        owner.kind === 'missing' ? 'missing' : 'invalid';
      if (owner.kind === 'reference') {
        const ownerMapping = await this.mappings.findActiveMappingByExternalId(
          owner.externalUserId,
        );
        if (
          ownerMapping &&
          this.inScope(ownerMapping) &&
          ownerMapping.zammadUserId === owner.externalUserId
        ) {
          const principal = await this.iam.getPrincipal(
            ownerMapping.coreUserId,
          );
          if (
            principal &&
            principal.userId === ownerMapping.coreUserId &&
            principal.status === 'ACTIVE' &&
            ['OPERATOR', 'TECHNICIAN'].includes(principal.role) &&
            (await this.eligible(owner.externalUserId))
          )
            ownerStatus = 'valid';
        }
      }
      if (actor.role === 'OPERATOR')
        return { status: 'allowed', ticket, businessOwnerStatus: ownerStatus };
      if (
        ownerStatus === 'valid' &&
        owner.kind === 'reference' &&
        (owner.externalUserId === mapping.zammadUserId ||
          ticket.nativeOwnerId === mapping.zammadUserId)
      )
        return { status: 'allowed', ticket, businessOwnerStatus: 'valid' };
      return { status: 'denied' };
    } catch (error) {
      if (
        error instanceof TicketReadError ||
        error instanceof IdentityMappingError ||
        error instanceof ExternalUserAccessError ||
        error instanceof TicketAuthorizationError
      )
        throw error;
      throw new TicketAuthorizationError('DEPENDENCY_FAILURE');
    }
  }
  async authorizeActor(authenticatedUserId: string) {
    validateCoreUserId(authenticatedUserId);
    const actor = await this.iam.getPrincipal(authenticatedUserId);
    if (
      !actor ||
      actor.userId !== authenticatedUserId ||
      actor.status !== 'ACTIVE' ||
      !['OPERATOR', 'TECHNICIAN'].includes(actor.role)
    )
      return null;
    if (!(await this.iam.hasAllPermissions(actor.userId, ['ticket:read'])))
      return null;
    const mapping = await this.mappings.findActiveMapping(actor.userId);
    if (
      !mapping ||
      !this.inScope(mapping) ||
      mapping.coreUserId !== actor.userId
    )
      return null;
    if (!(await this.eligible(mapping.zammadUserId))) return null;
    return { actor, mapping };
  }
  private inScope(value: IdentityMapping) {
    const mapping = validateIdentityMapping(value);
    return (
      mapping.status === 'ACTIVE' &&
      mapping.instanceKey === this.scope.instanceKey &&
      mapping.approvedGroupId === this.scope.approvedGroupId
    );
  }
  private async eligible(id: number) {
    const result = await this.external.getEligibleHuman(id);
    return (
      !!result &&
      result.externalUserId === id &&
      result.groupId === this.scope.approvedGroupId
    );
  }
}

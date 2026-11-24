import type { UnitOfWorkContext } from '@platform/events';

export type BindingRevocationResult =
  'revoked' | 'already-revoked' | 'not-found';

/** Persistence boundary for binding revocation. */
export interface BindingRevocationPort {
  revokeBinding(
    bindingId: string,
    actorId: string,
    revokedAt: Date,
    context: UnitOfWorkContext,
  ): Promise<BindingRevocationResult>;
}

export const BINDING_REVOCATION_PORT = Symbol('BINDING_REVOCATION_PORT');

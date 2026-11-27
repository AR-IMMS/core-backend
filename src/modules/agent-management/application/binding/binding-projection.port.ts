import type { UnitOfWorkContext } from '@platform/events';

export type BindingProjectionResult =
  'CREATED' | 'EXISTS' | 'REVOKED' | 'CONFLICT';

export interface BindingProjectionPort {
  hasActiveForNode(
    nodeId: string,
    context?: UnitOfWorkContext,
  ): Promise<boolean>;
  upsert(
    input: {
      readonly bindingId: string;
      readonly invitationId: string;
      readonly installationId: string;
      readonly nodeId: string;
      readonly createdAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<BindingProjectionResult>;
}

export const BINDING_PROJECTION_PORT = Symbol('BINDING_PROJECTION_PORT');

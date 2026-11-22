import type { UnitOfWorkContext } from '@platform/events';

export type FleetBindingProjectionResult =
  'CREATED' | 'EXISTS' | 'REVOKED' | 'CONFLICT';

export interface FleetBindingProjectionPort {
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
  ): Promise<FleetBindingProjectionResult>;
}

export const FLEET_BINDING_PROJECTION_PORT = Symbol(
  'FLEET_BINDING_PROJECTION_PORT',
);

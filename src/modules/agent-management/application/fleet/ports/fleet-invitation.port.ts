import type { FleetActorContext, FleetInvitationView } from '../fleet.types';

export interface FleetInvitationPort {
  create(input: {
    readonly nodeId: string;
    readonly operationId: string;
    readonly idempotencyKey: string;
    readonly requestedTtlSeconds: number;
    readonly actor: FleetActorContext;
  }): Promise<FleetInvitationView>;
  getByOperation(input: {
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInvitationView | null>;
  cancel(input: {
    readonly invitationId: string;
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<void>;
}

export const FLEET_INVITATION_PORT = Symbol('FLEET_INVITATION_PORT');

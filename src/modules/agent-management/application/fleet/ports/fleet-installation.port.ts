import type {
  FleetActorContext,
  FleetEnrollmentGate,
  FleetInstallationView,
} from '../fleet.types';

export interface FleetInstallationPort {
  findById(input: {
    readonly installationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInstallationView | null>;
  findActiveByNode(input: {
    readonly nodeId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInstallationView | null>;
  closeEnrollmentGate(input: {
    readonly nodeId: string;
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetEnrollmentGate>;
  completeEnrollmentGate(input: {
    readonly gate: FleetEnrollmentGate;
    readonly state: 'OPEN' | 'CLOSED';
    readonly actor: FleetActorContext;
  }): Promise<void>;
  revoke(input: {
    readonly installationId: string;
    readonly operationId: string;
    readonly actor: FleetActorContext;
  }): Promise<void>;
}

export const FLEET_INSTALLATION_PORT = Symbol('FLEET_INSTALLATION_PORT');

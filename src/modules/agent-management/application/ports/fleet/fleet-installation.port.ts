import type { FleetActorContext, FleetInstallationView } from './fleet.types';

export interface FleetInstallationPort {
  findById(input: {
    readonly installationId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInstallationView | null>;
  findActiveByNode(input: {
    readonly nodeId: string;
    readonly actor: FleetActorContext;
  }): Promise<FleetInstallationView | null>;
}

export const FLEET_INSTALLATION_PORT = Symbol('FLEET_INSTALLATION_PORT');

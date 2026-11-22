import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FLEET_INVITATION_PORT } from '../../application/fleet/ports/fleet-invitation.port';
import { FLEET_INSTALLATION_PORT } from '../../application/fleet/ports/fleet-installation.port';
import { FLEET_NODE_ENROLLMENT_GATE_PORT } from '../../application/fleet/ports/fleet-node-enrollment-gate.port';
import { FleetHttpClient } from './fleet-http-client';
import { FleetInvitationHttpAdapter } from './fleet-invitation.http-adapter';
import { FleetInstallationHttpAdapter } from './fleet-installation.http-adapter';
import { FleetNodeEnrollmentGateHttpAdapter } from './fleet-node-enrollment-gate.http-adapter';
import {
  DisabledFleetInvitationPort,
  DisabledFleetInstallationPort,
  DisabledFleetNodeEnrollmentGatePort,
} from './disabled-fleet-ports';

const FLEET_HTTP_CLIENT = Symbol('FLEET_HTTP_CLIENT');

@Module({
  providers: [
    {
      provide: FLEET_HTTP_CLIENT,
      useFactory: (config: ConfigService): FleetHttpClient | null => {
        if (!config.get<string>('FLEET_MANAGER_BASE_URL')) return null;
        return new FleetHttpClient({
          baseUrl: config.getOrThrow<string>('FLEET_MANAGER_BASE_URL'),
          clientCertificate: config.getOrThrow<string>(
            'FLEET_CLIENT_CERTIFICATE',
          ),
          clientKey: config.getOrThrow<string>('FLEET_CLIENT_KEY'),
          caCertificate: config.get<string>('FLEET_CA_CERTIFICATE'),
          timeoutMs: config.getOrThrow<number>('FLEET_REQUEST_TIMEOUT_MS'),
          maxRetries: config.getOrThrow<number>('FLEET_MAX_RETRIES'),
          maxRetryDelayMs: config.getOrThrow<number>(
            'FLEET_MAX_RETRY_DELAY_MS',
          ),
          maxResponseBytes: 64 * 1024,
        });
      },
      inject: [ConfigService],
    },
    {
      provide: FLEET_INVITATION_PORT,
      useFactory: (client: FleetHttpClient | null) =>
        client
          ? new FleetInvitationHttpAdapter(client)
          : new DisabledFleetInvitationPort(),
      inject: [FLEET_HTTP_CLIENT],
    },
    {
      provide: FLEET_INSTALLATION_PORT,
      useFactory: (client: FleetHttpClient | null) =>
        client
          ? new FleetInstallationHttpAdapter(client)
          : new DisabledFleetInstallationPort(),
      inject: [FLEET_HTTP_CLIENT],
    },
    {
      provide: FLEET_NODE_ENROLLMENT_GATE_PORT,
      useFactory: (client: FleetHttpClient | null) =>
        client
          ? new FleetNodeEnrollmentGateHttpAdapter(client)
          : new DisabledFleetNodeEnrollmentGatePort(),
      inject: [FLEET_HTTP_CLIENT],
    },
  ],
  exports: [
    FLEET_INVITATION_PORT,
    FLEET_INSTALLATION_PORT,
    FLEET_NODE_ENROLLMENT_GATE_PORT,
  ],
})
export class FleetManagerAdapterModule {}

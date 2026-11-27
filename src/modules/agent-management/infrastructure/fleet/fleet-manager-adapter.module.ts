import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { FLEET_INVITATION_PORT } from '../../application/ports/fleet/fleet-invitation.port';
import { FLEET_INSTALLATION_PORT } from '../../application/ports/fleet/fleet-installation.port';
import { FLEET_NODE_ENROLLMENT_GATE_PORT } from '../../application/ports/fleet/fleet-node-enrollment-gate.port';
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
          clientCertificate: readFleetPem(
            config,
            'FLEET_CLIENT_CERTIFICATE',
            'FLEET_CLIENT_CERTIFICATE_FILE',
          ),
          clientKey: readFleetPem(
            config,
            'FLEET_CLIENT_KEY',
            'FLEET_CLIENT_KEY_FILE',
          ),
          caCertificate: readOptionalFleetPem(
            config,
            'FLEET_CA_CERTIFICATE',
            'FLEET_CA_CERTIFICATE_FILE',
          ),
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

function readFleetPem(
  config: ConfigService,
  inlineName: string,
  fileName: string,
): string {
  const filePath = config.get<string>(fileName);
  return filePath
    ? readFileSync(filePath, 'utf8')
    : config.getOrThrow<string>(inlineName);
}

function readOptionalFleetPem(
  config: ConfigService,
  inlineName: string,
  fileName: string,
): string | undefined {
  const filePath = config.get<string>(fileName);
  return filePath
    ? readFileSync(filePath, 'utf8')
    : config.get<string>(inlineName);
}

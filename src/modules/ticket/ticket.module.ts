import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import {
  ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
  type AssetTopologyAssetQueries,
} from '@modules/asset-topology';
import { AssetTopologyModule } from '@modules/asset-topology/asset-topology.module';
import {
  OUTBOX_WRITER_PORT,
  UNIT_OF_WORK_PORT,
  type OutboxWriterPort,
  type UnitOfWorkPort,
} from '@platform/events';

import { PlatformConfigModule } from '@platform/config';
import {
  IAM_HUMAN_ACCESS_PORT,
  IAM_HUMAN_DIRECTORY_PORT,
  type HumanAccessPort,
  type HumanDirectoryPort,
} from '@modules/iam';
import { IamModule } from '@modules/iam/iam.module';
import { GetAuthorizedTicket } from './application/get-authorized-ticket';
import {
  TICKET_READ_PORT,
  type TicketReadPort,
} from './application/ticket-read.port';
import {
  IDENTITY_MAPPING_DIRECTORY,
  IDENTITY_MAPPING_READ_PORT,
  type IdentityMappingDirectory,
  type IdentityMappingReadPort,
} from './application/identity-mapping-read.port';
import {
  EXTERNAL_USER_ACCESS_PORT,
  type ExternalUserAccessPort,
} from './application/external-user-access.port';
import { TicketIdentityModule } from './ticket-identity.module';
import { ZammadUserAccessModule } from './zammad-user-access.module';
import { TicketController } from './presentation/ticket.controller';
import { TicketWorkflowController } from './presentation/ticket-workflow.controller';
import { TicketNotificationsController } from './presentation/ticket-notifications.controller';
import { TicketNotifications } from './application/ticket-notifications';
import { TicketExtrasController } from './presentation/ticket-extras.controller';
import { TicketEvidence } from './application/ticket-evidence';
import { PrivateTicketEvidenceFiles } from './infrastructure/private-ticket-evidence-files';
import { TicketJournal } from './application/ticket-journal';
import { TicketWorkflow } from './application/ticket-workflow';
import {
  TICKET_WORKFLOW_LINKS_PORT,
  type TicketWorkflowLinksPort,
} from './application/ticket-workflow-links.port';
import { MongoTicketJournalStore } from './infrastructure/mongodb/mongo-ticket-journal.store';
import { ZammadTicketWorkflowAdapter } from './infrastructure/zammad-ticket-workflow.adapter';
import { parseZammadReadConfig } from './infrastructure/zammad-read.config';
import { ZammadTicketReadAdapter } from './infrastructure/zammad-ticket-read.adapter';

@Module({
  imports: [
    PlatformConfigModule,
    IamModule,
    TicketIdentityModule,
    ZammadUserAccessModule,
    AssetTopologyModule,
  ],
  controllers: [
    TicketNotificationsController,
    TicketExtrasController,
    TicketController,
    TicketWorkflowController,
  ],
  providers: [
    {
      provide: TicketNotifications,
      inject: [GetAuthorizedTicket, MongoTicketJournalStore, ConfigService],
      useFactory: (
        access: GetAuthorizedTicket,
        store: MongoTicketJournalStore,
        config: ConfigService,
      ) =>
        new TicketNotifications(access, store, {
          instanceKey: config.getOrThrow<string>('ZAMMAD_INSTANCE_KEY'),
          approvedGroupId: Number(
            config.getOrThrow<string>('ZAMMAD_EXPECTED_GROUP_ID'),
          ),
        }),
    },
    {
      provide: TicketEvidence,
      inject: [
        TicketWorkflow,
        MongoTicketJournalStore,
        UNIT_OF_WORK_PORT,
        OUTBOX_WRITER_PORT,
        ConfigService,
      ],
      useFactory: (
        workflow: TicketWorkflow,
        store: MongoTicketJournalStore,
        uow: UnitOfWorkPort,
        outbox: OutboxWriterPort,
        config: ConfigService,
      ) => {
        const directory = config.get<string>('TICKET_EVIDENCE_DIRECTORY');
        const secret = config.get<string>('TICKET_EVIDENCE_SIGNING_KEY');
        if (Boolean(directory) !== Boolean(secret))
          throw new Error(
            'Set both Ticket Evidence storage settings or neither',
          );
        return new TicketEvidence(
          workflow,
          store,
          new TicketJournal(store, uow, outbox),
          {
            instance: config.getOrThrow<string>('ZAMMAD_INSTANCE_KEY'),
            group: Number(
              config.getOrThrow<string>('ZAMMAD_EXPECTED_GROUP_ID'),
            ),
          },
          directory && secret
            ? { files: new PrivateTicketEvidenceFiles(directory), secret }
            : undefined,
        );
      },
    },
    {
      provide: MongoTicketJournalStore,
      inject: [getConnectionToken()],
      useFactory: async (connection: Connection) => {
        const store = new MongoTicketJournalStore(connection);
        await store.initialize();
        return store;
      },
    },
    {
      provide: TicketWorkflow,
      inject: [
        GetAuthorizedTicket,
        IAM_HUMAN_ACCESS_PORT,
        TICKET_READ_PORT,
        MongoTicketJournalStore,
        ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
        UNIT_OF_WORK_PORT,
        OUTBOX_WRITER_PORT,
        ConfigService,
        IAM_HUMAN_DIRECTORY_PORT,
        IDENTITY_MAPPING_DIRECTORY,
        { token: TICKET_WORKFLOW_LINKS_PORT, optional: true },
      ],
      useFactory: (
        query: GetAuthorizedTicket,
        iam: HumanAccessPort,
        tickets: TicketReadPort,
        store: MongoTicketJournalStore,
        assets: AssetTopologyAssetQueries,
        uow: UnitOfWorkPort,
        outbox: OutboxWriterPort,
        config: ConfigService,
        identities: HumanDirectoryPort,
        candidates: IdentityMappingDirectory,
        integrations?: TicketWorkflowLinksPort,
      ) =>
        new TicketWorkflow(
          query,
          iam,
          new ZammadTicketWorkflowAdapter(
            readConfig(config),
            Number(config.getOrThrow<string>('ZAMMAD_TICKET_CUSTOMER_ID')),
          ),
          tickets,
          new TicketJournal(store, uow, outbox),
          store,
          assets,
          {
            instanceKey: config.getOrThrow<string>('ZAMMAD_INSTANCE_KEY'),
            approvedGroupId: Number(
              config.getOrThrow<string>('ZAMMAD_EXPECTED_GROUP_ID'),
            ),
          },
          Number(config.getOrThrow<string>('ZAMMAD_SERVICE_USER_ID')),
          integrations,
          { identities, candidates },
        ),
    },
    {
      provide: GetAuthorizedTicket,
      inject: [
        IAM_HUMAN_ACCESS_PORT,
        IDENTITY_MAPPING_READ_PORT,
        EXTERNAL_USER_ACCESS_PORT,
        TICKET_READ_PORT,
        ConfigService,
        MongoTicketJournalStore,
      ],
      useFactory: (
        iam: HumanAccessPort,
        mappings: IdentityMappingReadPort,
        external: ExternalUserAccessPort,
        tickets: TicketReadPort,
        config: ConfigService,
        store: MongoTicketJournalStore,
      ) =>
        new GetAuthorizedTicket(
          iam,
          mappings,
          external,
          tickets,
          {
            instanceKey: config.getOrThrow<string>('ZAMMAD_INSTANCE_KEY'),
            approvedGroupId: Number(
              config.getOrThrow<string>('ZAMMAD_EXPECTED_GROUP_ID'),
            ),
          },
          store,
        ),
    },
    {
      provide: TICKET_READ_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new ZammadTicketReadAdapter(readConfig(config)),
    },
  ],
})
export class TicketModule {}

function readConfig(config: ConfigService) {
  return parseZammadReadConfig({
    baseUrl: config.get<unknown>('ZAMMAD_BASE_URL'),
    privateHttpOrigin: config.get<unknown>('ZAMMAD_PRIVATE_HTTP_ORIGIN'),
    apiToken: config.get<unknown>('ZAMMAD_API_TOKEN'),
    expectedGroupId: config.get<unknown>('ZAMMAD_EXPECTED_GROUP_ID'),
    timeoutMs: config.get<unknown>('ZAMMAD_READ_TIMEOUT_MS'),
  });
}

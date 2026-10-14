import { Module } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';

import {
  IAM_PERMISSION_CATALOG_PORT,
  PermissionCatalogModule,
  type PermissionCatalogPort,
} from '@modules/iam';
import { AuditEventConsumer } from './application/audit-event.consumer';
import { GetAuditEventUseCase } from './application/get-audit-event.use-case';
import { ListAuditEventsUseCase } from './application/list-audit-events.use-case';
import { AUDIT_RECORD_QUERY_STORE_PORT } from './application/ports/audit-record-query-store.port.token';
import type { AuditRecordStorePort } from './application/ports/audit-record-store.port';
import {
  AUDIT_RECORD_MODEL,
  AuditRecordSchema,
} from './infrastructure/mongodb/audit-record.schema';
import {
  MongoAuditRecordStore,
  type MongoAuditRecordModel,
} from './infrastructure/mongodb/mongo-audit-record.store';
import { AUDIT_RECORD_STORE_PORT } from './infrastructure/mongodb/audit-record-store.port.token';
import { AuditController } from './presentation/audit.controller';
import { AuditReadGuard } from './presentation/audit-read.guard';

/** Composes Audit's internal consumer and append-only MongoDB adapter. */
@Module({
  controllers: [AuditController],
  imports: [
    PermissionCatalogModule,
    MongooseModule.forFeature([
      { name: AUDIT_RECORD_MODEL, schema: AuditRecordSchema },
    ]),
  ],
  providers: [
    {
      provide: AUDIT_RECORD_STORE_PORT,
      useFactory: (model: MongoAuditRecordModel): AuditRecordStorePort =>
        new MongoAuditRecordStore(model),
      inject: [getModelToken(AUDIT_RECORD_MODEL)],
    },
    {
      provide: AuditEventConsumer,
      useFactory: (
        store: AuditRecordStorePort,
        permissionCatalog: PermissionCatalogPort,
      ) => new AuditEventConsumer(store, permissionCatalog),
      inject: [AUDIT_RECORD_STORE_PORT, IAM_PERMISSION_CATALOG_PORT],
    },
    {
      provide: AUDIT_RECORD_QUERY_STORE_PORT,
      useExisting: AUDIT_RECORD_STORE_PORT,
    },
    {
      provide: ListAuditEventsUseCase,
      useFactory: (
        store: ConstructorParameters<typeof ListAuditEventsUseCase>[0],
      ) => new ListAuditEventsUseCase(store),
      inject: [AUDIT_RECORD_QUERY_STORE_PORT],
    },
    {
      provide: GetAuditEventUseCase,
      useFactory: (
        store: ConstructorParameters<typeof GetAuditEventUseCase>[0],
      ) => new GetAuditEventUseCase(store),
      inject: [AUDIT_RECORD_QUERY_STORE_PORT],
    },
    AuditReadGuard,
  ],
  exports: [AuditEventConsumer],
})
export class AuditModule {}

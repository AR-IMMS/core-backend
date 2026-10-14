import { Module } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';

import {
  IAM_PERMISSION_CATALOG_PORT,
  PermissionCatalogModule,
  type PermissionCatalogPort,
} from '@modules/iam';
import { AuditEventConsumer } from './application/audit-event.consumer';
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

/** Composes Audit's internal consumer and append-only MongoDB adapter. */
@Module({
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
  ],
  exports: [AuditEventConsumer],
})
export class AuditModule {}

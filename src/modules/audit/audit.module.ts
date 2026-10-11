import { Module } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';

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
      useFactory: (store: AuditRecordStorePort) =>
        new AuditEventConsumer(store),
      inject: [AUDIT_RECORD_STORE_PORT],
    },
  ],
  exports: [AuditEventConsumer],
})
export class AuditModule {}

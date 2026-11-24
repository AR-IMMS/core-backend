import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { PlatformConfigModule } from '@platform/config';
import {
  IDENTITY_MAPPING_DIRECTORY,
  IDENTITY_MAPPING_READ_PORT,
} from './application/identity-mapping-read.port';
import type { IdentityMapping } from './domain/identity-mapping';
import {
  IDENTITY_MAPPING_MODEL,
  IdentityMappingSchema,
} from './infrastructure/mongodb/identity-mapping.schema';
import { MongoIdentityMappingStore } from './infrastructure/mongodb/mongo-identity-mapping.store';
/** Internal composition. Host must supply Mongo connection; no public HTTP registration. */
@Module({
  imports: [
    PlatformConfigModule,
    MongooseModule.forFeature([
      { name: IDENTITY_MAPPING_MODEL, schema: IdentityMappingSchema },
    ]),
  ],
  providers: [
    {
      provide: IDENTITY_MAPPING_READ_PORT,
      inject: [getModelToken(IDENTITY_MAPPING_MODEL), ConfigService],
      useFactory: async (
        model: Model<IdentityMapping>,
        config: ConfigService,
      ) => {
        const store = new MongoIdentityMappingStore(model, {
          instanceKey: config.get<string>('ZAMMAD_INSTANCE_KEY') ?? '',
          approvedGroupId: Number(
            config.get<string>('ZAMMAD_EXPECTED_GROUP_ID'),
          ),
        });
        // Fail activation if unique indexes cannot be established. Never drop indexes.
        await model.createIndexes();
        return store;
      },
    },
    {
      provide: IDENTITY_MAPPING_DIRECTORY,
      useExisting: IDENTITY_MAPPING_READ_PORT,
    },
  ],
  exports: [IDENTITY_MAPPING_READ_PORT, IDENTITY_MAPPING_DIRECTORY],
})
export class TicketIdentityModule {}

import { Module } from '@nestjs/common';

import { PermissionCatalogService } from './application/permission-catalog.service';
import { IAM_PERMISSION_CATALOG_PORT } from './application/ports/permission-catalog.token';

/** Exposes IAM's fixed permission catalog through its application contract. */
@Module({
  providers: [
    {
      provide: IAM_PERMISSION_CATALOG_PORT,
      useClass: PermissionCatalogService,
    },
  ],
  exports: [IAM_PERMISSION_CATALOG_PORT],
})
export class PermissionCatalogModule {}

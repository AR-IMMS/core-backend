import { Module } from '@nestjs/common';

import { PlatformConfigModule } from '@platform/config/config.module';
import { HttpModule } from '@platform/http/http.module';

/**
 * Composes the shared platform modules used by the Core application.
 */
@Module({
  imports: [PlatformConfigModule, HttpModule],
})
export class CoreModule {}

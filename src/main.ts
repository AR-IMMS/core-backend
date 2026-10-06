import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { CoreModule } from './app/core.module';
import { API_PREFIX } from '@platform/http';
import { RequestMethod } from '@nestjs/common';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(CoreModule);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();

  const port = configService.getOrThrow<number>('APP_PORT');

  await app.listen(port);
}

void bootstrap();

import './instrumentation';

import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';

import { CoreModule } from './app/core.module';
import { API_PREFIX } from '@platform/http';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(CoreModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));

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

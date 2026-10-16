import './instrumentation';

import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';

import { CoreModule } from './app/core.module';
import { API_PREFIX } from '@platform/http';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(CoreModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));

  const configService = app.get(ConfigService);

  const browserOrigins = (
    configService.get<string>('IAM_BROWSER_ALLOWED_ORIGINS') ?? ''
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, origin !== undefined && browserOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  });

  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AR-IMMS Core API')
    .setDescription('HTTP API documentation for implemented Core endpoints.')
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'HumanAccessToken',
    )
    .addCookieAuth(
      '__Secure-arimms_refresh',
      { type: 'apiKey', in: 'cookie' },
      'BrowserRefreshCookie',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  app.enableShutdownHooks();

  const port = configService.getOrThrow<number>('APP_PORT');

  await app.listen(port);
}

void bootstrap();

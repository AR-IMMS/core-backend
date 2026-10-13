import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';

import { REQUEST_ID_HEADER } from '../http.constants';

/**
 * RequestContextModule manages request-scoped context and correlation IDs.
 *
 * Leveraging `nestjs-cls`, this module automatically provisions a unique cryptographically
 * UUID for each incoming HTTP request, propagates it across asynchronous
 * boundaries, and writes it to the `X-Request-Id` response header.
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: () => randomUUID(),
        setup: (cls, _request, response: Response) => {
          response.setHeader(REQUEST_ID_HEADER, cls.getId());
        },
      },
    }),
  ],
})
export class RequestContextModule {}

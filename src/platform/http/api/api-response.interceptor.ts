import {
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { trace } from '@opentelemetry/api';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { map, type Observable } from 'rxjs';

import { createApiMeta } from './api-meta';
import { createListResponse, createSingleResponse } from './response.factory';
import { RAW_RESPONSE_METADATA } from './raw-response.decorator';
import { PaginatedResult } from './pagination/paginated-result';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor<
  unknown,
  unknown
> {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
    @InjectPinoLogger(ApiResponseInterceptor.name)
    private readonly logger: PinoLogger,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    if (context.getType() !== 'http' || this.isRawResponse(context)) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((payload: unknown): unknown => {
        if (response.statusCode === Number(HttpStatus.NO_CONTENT)) {
          return payload;
        }

        const spanContext = trace.getActiveSpan()?.spanContext();
        const meta = createApiMeta(this.cls.getId(), spanContext?.traceId);

        let responseBody: unknown;
        if (payload instanceof PaginatedResult) {
          responseBody = createListResponse(
            payload.items,
            meta,
            payload.pagination,
          );
        } else {
          responseBody = createSingleResponse(
            payload === undefined ? null : payload,
            meta,
          );
        }

        if (this.logger.logger.isLevelEnabled('debug')) {
          this.logger.debug(
            {
              requestId: meta.request_id,
              statusCode: response.statusCode,
              response: sanitizeResponseBody(responseBody),
            },
            'HTTP response body',
          );
        }

        return responseBody;
      }),
    );
  }

  private isRawResponse(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false
    );
  }
}

function sanitizeResponseBody(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeResponseBody);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        isSensitiveField(key) ? '[REDACTED]' : sanitizeResponseBody(entry),
      ]),
    );
  }

  return value;
}

function isSensitiveField(fieldName: string): boolean {
  return /(?:access|refresh|bootstrap|bearer)[_-]?token|(?:^|[_-])token(?:$|[_-](?!type\b))|secret|password|credential|authorization|cookie|api[_-]?key/i.test(
    fieldName,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

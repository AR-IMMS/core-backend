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

        if (payload instanceof PaginatedResult) {
          return createListResponse(payload.items, meta, payload.pagination);
        }

        return createSingleResponse(
          payload === undefined ? null : payload,
          meta,
        );
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

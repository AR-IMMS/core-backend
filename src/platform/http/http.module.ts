import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { ProblemDetailsExceptionFilter } from './errors/problem-details.filter';
import { RequestContextModule } from './request-context/request-context.module';
import { CoreZodValidationPipe } from './validation/zod-validation.pipe';
import { ApiResponseInterceptor } from './api/api-response.interceptor';

/**
 * Provides shared HTTP request processing for the Core application.
 */
@Module({
  imports: [RequestContextModule],
  providers: [
    {
      provide: APP_PIPE,
      useClass: CoreZodValidationPipe,
    },
    {
      provide: APP_FILTER,
      useClass: ProblemDetailsExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiResponseInterceptor,
    },
  ],
})
export class HttpModule {}

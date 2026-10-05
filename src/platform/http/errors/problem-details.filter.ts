import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';

import type { EnvConfig } from '../../config/env.schema';
import { mapExceptionToProblemDetails } from './problem-details.mapper';

/**
 * Writes mapped exceptions as HTTP Problem Details responses.
 */
@Catch()
export class ProblemDetailsExceptionFilter implements ExceptionFilter<unknown> {
  private readonly logger = new Logger(ProblemDetailsExceptionFilter.name);

  constructor(
    private readonly cls: ClsService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const requestId = this.cls.getId();

    this.logIfUnexpected(exception, requestId);

    const problem = mapExceptionToProblemDetails(
      exception,
      request.path,
      requestId,
      this.config.get('NODE_ENV', { infer: true }) === 'development',
    );

    response.status(problem.status);
    response.setHeader('Content-Type', 'application/problem+json');
    response.json(problem);
  }

  private logIfUnexpected(exception: unknown, requestId: string): void {
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      return;
    }

    const message = `Unhandled exception for request ${requestId}`;

    if (exception instanceof Error) {
      this.logger.error(message, exception.stack);
      return;
    }

    this.logger.error(`${message}: ${String(exception)}`);
  }
}

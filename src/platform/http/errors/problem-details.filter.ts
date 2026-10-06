import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';

import type { EnvConfig } from '../../config/env.schema';
import { mapExceptionToProblemDetails } from './problem-details.mapper';

const HEALTH_READINESS_PATH = '/health/ready';

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

    if (this.isTerminusReadinessFailure(exception, request.path)) {
      this.writeTerminusReadinessResponse(exception, response);
      return;
    }

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

  private isTerminusReadinessFailure(
    exception: unknown,
    requestPath: string,
  ): exception is HttpException {
    if (
      requestPath !== HEALTH_READINESS_PATH ||
      !(exception instanceof HttpException) ||
      exception.getStatus() !== Number(HttpStatus.SERVICE_UNAVAILABLE)
    ) {
      return false;
    }

    const body = exception.getResponse();

    return (
      isRecord(body) &&
      body['status'] === 'error' &&
      isRecord(body['error']) &&
      isRecord(body['details'])
    );
  }

  private writeTerminusReadinessResponse(
    exception: HttpException,
    response: Response,
  ): void {
    response.status(exception.getStatus());
    response.setHeader('Content-Type', 'application/json');
    response.json(exception.getResponse());
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

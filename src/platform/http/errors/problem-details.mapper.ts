import { HttpException, HttpStatus } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod/v4';

import {
  mapZodIssues,
  type ValidationFieldError,
} from './validation-error.mapper';

export interface ProblemDetailsResponse {
  type: 'about:blank';
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  request_id: string;
  errors?: ValidationFieldError[];
}

interface HttpErrorPresentation {
  code: string;
  title: string;
  detail: string;
}

const INTERNAL_SERVER_ERROR_THRESHOLD = Number(
  HttpStatus.INTERNAL_SERVER_ERROR,
);

const HTTP_ERROR_PRESENTATIONS = new Map<number, HttpErrorPresentation>([
  [
    HttpStatus.BAD_REQUEST,
    {
      code: 'BAD_REQUEST',
      title: 'Bad Request',
      detail: 'The request could not be processed.',
    },
  ],
  [
    HttpStatus.UNAUTHORIZED,
    {
      code: 'UNAUTHORIZED',
      title: 'Unauthorized',
      detail: 'Authentication is required.',
    },
  ],
  [
    HttpStatus.FORBIDDEN,
    {
      code: 'FORBIDDEN',
      title: 'Forbidden',
      detail: 'You are not allowed to perform this action.',
    },
  ],
  [
    HttpStatus.NOT_FOUND,
    {
      code: 'NOT_FOUND',
      title: 'Not Found',
      detail: 'The requested resource was not found.',
    },
  ],
  [
    HttpStatus.CONFLICT,
    {
      code: 'CONFLICT',
      title: 'Conflict',
      detail: 'The request conflicts with the current resource state.',
    },
  ],
  [
    HttpStatus.UNPROCESSABLE_ENTITY,
    {
      code: 'UNPROCESSABLE_ENTITY',
      title: 'Unprocessable Entity',
      detail: 'The request could not be processed.',
    },
  ],
  [
    HttpStatus.TOO_MANY_REQUESTS,
    {
      code: 'TOO_MANY_REQUESTS',
      title: 'Too Many Requests',
      detail: 'Too many requests were received.',
    },
  ],
]);

/**
 * Converts application exceptions into the public Problem Details contract.
 */
export function mapExceptionToProblemDetails(
  exception: unknown,
  instance: string,
  requestId: string,
  isDevelopment: boolean,
): ProblemDetailsResponse {
  if (exception instanceof ZodValidationException) {
    const zodError = exception.getZodError();

    const errors =
      zodError instanceof ZodError
        ? mapZodIssues(zodError.issues)
        : [
            {
              field: [],
              code: 'INVALID_VALUE' as const,
              message: 'Request data is invalid.',
            },
          ];

    return {
      type: 'about:blank',
      title: 'Request validation failed',
      status: HttpStatus.BAD_REQUEST,
      detail: 'One or more request fields are invalid.',
      instance,
      code: 'VALIDATION_ERROR',
      request_id: requestId,
      errors,
    };
  }

  if (exception instanceof HttpException) {
    return mapHttpException(exception, instance, requestId, isDevelopment);
  }

  return {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    detail: getUnexpectedErrorDetail(exception, isDevelopment),
    instance,
    code: 'INTERNAL_SERVER_ERROR',
    request_id: requestId,
  };
}

function mapHttpException(
  exception: HttpException,
  instance: string,
  requestId: string,
  isDevelopment: boolean,
): ProblemDetailsResponse {
  const status = exception.getStatus();
  const presentation = getHttpErrorPresentation(status);
  const isServerError = status >= INTERNAL_SERVER_ERROR_THRESHOLD;

  return {
    type: 'about:blank',
    title: presentation.title,
    status,
    detail: isServerError
      ? getUnexpectedErrorDetail(exception, isDevelopment)
      : (getHttpExceptionDetail(exception.getResponse()) ??
        presentation.detail),
    instance,
    code: presentation.code,
    request_id: requestId,
  };
}

function getHttpErrorPresentation(status: number): HttpErrorPresentation {
  const knownPresentation = HTTP_ERROR_PRESENTATIONS.get(status);

  if (knownPresentation) {
    return knownPresentation;
  }

  if (status >= INTERNAL_SERVER_ERROR_THRESHOLD) {
    return {
      code: 'INTERNAL_SERVER_ERROR',
      title: 'Internal Server Error',
      detail: 'An unexpected error occurred.',
    };
  }

  return {
    code: 'HTTP_ERROR',
    title: 'Request Failed',
    detail: 'The request could not be completed.',
  };
}

function getHttpExceptionDetail(
  exceptionResponse: unknown,
): string | undefined {
  if (typeof exceptionResponse === 'string') {
    return exceptionResponse;
  }

  if (!isRecord(exceptionResponse)) {
    return undefined;
  }

  const message = exceptionResponse['message'];

  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(message) && message.length > 0 && message.every(isString)) {
    return message.join('; ');
  }

  return undefined;
}

function getUnexpectedErrorDetail(
  exception: unknown,
  isDevelopment: boolean,
): string {
  if (!isDevelopment || !(exception instanceof Error)) {
    return 'An unexpected error occurred.';
  }

  return exception.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

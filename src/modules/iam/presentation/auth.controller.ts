import {
  BadRequestException,
  Controller,
  ConflictException,
  HttpException,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import { z, ZodError } from 'zod';

import {
  AuthService,
  AuthRateLimitExceededError,
  InvalidCredentialsError,
  RefreshTokenReplayError,
} from '../application/auth.service';
import {
  AuditSequenceConflictError,
  CurrentPasswordMismatchError,
  UserProvisioningService,
} from '../application/user-provisioning.service';
import type { AuthenticatedHumanPrincipal } from '../application/ports/human-session-access.port';
import { HumanAccessGuard } from './human-access.guard';

interface AuthenticatedHumanRequest {
  readonly user: AuthenticatedHumanPrincipal;
  readonly body: unknown;
}

const loginSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1),
  })
  .strict();

const refreshSchema = z.object({ refresh_token: z.string().min(32) }).strict();
const initialPasswordChangeSchema = z
  .object({
    current_password: z.string().min(1).optional(),
    new_password: z.string().min(12),
  })
  .strict();

const tokenSetResponseSchema = singleResponseSchema({
  type: 'object',
  required: [
    'access_token',
    'refresh_token',
    'token_type',
    'expires_in',
    'refresh_expires_at',
    'must_change_password',
  ],
  properties: {
    access_token: { type: 'string' },
    refresh_token: { type: 'string' },
    token_type: { type: 'string', enum: ['Bearer'] },
    expires_in: { type: 'integer' },
    refresh_expires_at: { type: 'string', format: 'date-time' },
    must_change_password: { type: 'boolean' },
  },
});

/** Native JSON token endpoints and session logout for IAM clients. */
@ApiTags('IAM Authentication')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly provisioning: UserProvisioningService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with username/email and password' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['identifier', 'password'],
      additionalProperties: false,
      properties: {
        identifier: { type: 'string', minLength: 1, maxLength: 254 },
        password: { type: 'string', minLength: 1, writeOnly: true },
      },
    },
  })
  @ApiOkResponse({
    description: 'Native access and refresh tokens. Response is no-store.',
    schema: tokenSetResponseSchema,
  })
  @ApiBadRequestResponse({ description: 'Invalid request body.' })
  @ApiUnauthorizedResponse({ description: 'Credentials are invalid.' })
  @ApiTooManyRequestsResponse({
    description: 'Authentication rate limit exceeded.',
  })
  async login(
    @Req() request: { readonly body: unknown; readonly ip?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseRequest(
      loginSchema,
      request.body,
      'Invalid login request',
    );
    response.setHeader('Cache-Control', 'no-store');
    try {
      await this.auth.checkLoginRateLimit(
        input.identifier,
        request.ip ?? 'unknown',
      );
      return serializeTokenSet(
        await this.auth.login({
          identifier: input.identifier,
          password: input.password,
        }),
      );
    } catch (error) {
      if (error instanceof AuthRateLimitExceededError) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
        throw new HttpException(
          'Too many authentication attempts',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (error instanceof InvalidCredentialsError) {
        this.logger.warn('iam.auth.login.failed');
        throw new UnauthorizedException('Invalid credentials');
      }
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a native refresh token' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['refresh_token'],
      additionalProperties: false,
      properties: {
        refresh_token: { type: 'string', minLength: 32, writeOnly: true },
      },
    },
  })
  @ApiOkResponse({
    description: 'Rotated token set. Response is no-store.',
    schema: tokenSetResponseSchema,
  })
  @ApiBadRequestResponse({ description: 'Invalid request body.' })
  @ApiUnauthorizedResponse({
    description: 'Refresh token is invalid or reused.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Authentication rate limit exceeded.',
  })
  async refresh(
    @Req() request: { readonly body: unknown; readonly ip?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseRequest(
      refreshSchema,
      request.body,
      'Invalid refresh request',
    );
    response.setHeader('Cache-Control', 'no-store');
    try {
      return serializeTokenSet(
        await this.auth.refresh(input.refresh_token, request.ip ?? 'unknown'),
      );
    } catch (error) {
      if (error instanceof AuthRateLimitExceededError) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
        throw new HttpException(
          'Too many authentication attempts',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (error instanceof InvalidCredentialsError) {
        if (error instanceof RefreshTokenReplayError) {
          this.logger.warn('iam.auth.refresh.replay_detected');
        }
        throw new UnauthorizedException('Refresh token is invalid');
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(HumanAccessGuard)
  @ApiOperation({ summary: 'Revoke the current authenticated session' })
  @ApiBearerAuth('HumanAccessToken')
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Session revoked.',
  })
  @ApiUnauthorizedResponse({
    description: 'Access token is missing or invalid.',
  })
  async logout(@Req() request: AuthenticatedHumanRequest): Promise<void> {
    await this.auth.logout(request.user.sessionId);
    this.logger.log('iam.auth.logout.completed');
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(HumanAccessGuard)
  @ApiOperation({ summary: 'Change the authenticated user password' })
  @ApiBearerAuth('HumanAccessToken')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['new_password'],
      additionalProperties: false,
      properties: {
        current_password: { type: 'string', writeOnly: true },
        new_password: { type: 'string', minLength: 12, writeOnly: true },
      },
    },
  })
  @ApiOkResponse({
    description: 'Password changed.',
    schema: singleResponseSchema({
      type: 'object',
      properties: { changed: { type: 'boolean', enum: [true] } },
    }),
  })
  @ApiBadRequestResponse({ description: 'Invalid password change request.' })
  @ApiUnauthorizedResponse({
    description: 'Authentication or current password failed.',
  })
  @ApiForbiddenResponse({
    description: 'The account is not permitted to change password.',
  })
  @ApiConflictResponse({ description: 'The account changed concurrently.' })
  async changePassword(@Req() request: AuthenticatedHumanRequest) {
    const input = parseRequest(
      initialPasswordChangeSchema,
      request.body,
      'Invalid password change request',
    );
    try {
      await this.provisioning.changePassword({
        userId: request.user.userId,
        sessionId: request.user.sessionId,
        ...(input.current_password === undefined
          ? {}
          : { currentPassword: input.current_password }),
        newPassword: input.new_password,
      });
    } catch (error) {
      if (error instanceof CurrentPasswordMismatchError) {
        throw new UnauthorizedException('Current password is invalid');
      }
      if (error instanceof AuditSequenceConflictError) {
        throw new ConflictException('Account changed concurrently');
      }
      throw error;
    }
    return { changed: true };
  }
}

function singleResponseSchema(data: SchemaObject): SchemaObject {
  return {
    type: 'object',
    required: ['data', 'meta'],
    properties: {
      data,
      meta: {
        type: 'object',
        required: ['request_id'],
        properties: {
          request_id: { type: 'string' },
          trace_id: { type: 'string' },
        },
      },
    },
  };
}

function parseRequest<T extends z.ZodType>(
  schema: T,
  input: unknown,
  message: string,
): z.infer<T> {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) throw new BadRequestException({ message });
    throw error;
  }
}

function serializeTokenSet(
  tokenSet: Awaited<ReturnType<AuthService['login']>>,
) {
  return {
    access_token: tokenSet.accessToken,
    refresh_token: tokenSet.refreshToken,
    token_type: tokenSet.tokenType,
    expires_in: tokenSet.expiresIn,
    refresh_expires_at: tokenSet.refreshExpiresAt.toISOString(),
    must_change_password: tokenSet.mustChangePassword,
  };
}

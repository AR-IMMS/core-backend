import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import { z, ZodError } from 'zod';

import { IAM_ROLE_CODES } from '../domain/role-permissions';
import {
  AuditSequenceConflictError,
  UserProvisioningService,
} from '../application/user-provisioning.service';
import type { AuthenticatedHumanPrincipal } from '../application/ports/human-session-access.port';
import { RequirePermissions } from './authorization.decorators';

interface AuthenticatedHumanRequest {
  readonly user: AuthenticatedHumanPrincipal;
  readonly body: unknown;
}

const createUserSchema = z
  .object({
    username: z.string().trim().min(3).max(64),
    email: z.email().max(254),
    display_name: z.string().trim().min(1).max(128).optional(),
    role: z.enum(IAM_ROLE_CODES),
  })
  .strict();

/** Admin-protected user provisioning endpoint. */
@ApiTags('IAM Users')
@Controller('users')
export class UsersController {
  constructor(private readonly provisioning: UserProvisioningService) {}

  @Post()
  @RequirePermissions('user:manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Provision a user account' })
  @ApiBearerAuth('HumanAccessToken')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['username', 'email', 'role'],
      additionalProperties: false,
      properties: {
        username: { type: 'string', minLength: 3, maxLength: 64 },
        email: { type: 'string', format: 'email', maxLength: 254 },
        display_name: { type: 'string', minLength: 1, maxLength: 128 },
        role: { type: 'string', enum: ['IT_ADMIN', 'OPERATOR', 'TECHNICIAN'] },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'User created; generated temporary password is returned once. Response is no-store.',
    schema: singleResponseSchema({
      type: 'object',
      required: [
        'id',
        'username',
        'email',
        'role',
        'additional_permissions',
        'effective_permissions',
        'status',
        'must_change_password',
        'created_at',
        'updated_at',
        'temporary_password',
      ],
      properties: {
        id: { type: 'string' },
        username: { type: 'string' },
        email: { type: 'string', format: 'email' },
        display_name: { type: 'string', nullable: true },
        role: { type: 'string', enum: ['IT_ADMIN', 'OPERATOR', 'TECHNICIAN'] },
        additional_permissions: { type: 'array', items: { type: 'string' } },
        effective_permissions: { type: 'array', items: { type: 'string' } },
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
        must_change_password: { type: 'boolean', enum: [true] },
        created_at: { type: 'string', format: 'date-time' },
        updated_at: { type: 'string', format: 'date-time' },
        temporary_password: {
          type: 'string',
          description:
            'One-time credential; never persist or log in plaintext.',
        },
      },
    }),
  })
  @ApiBadRequestResponse({ description: 'User request is invalid.' })
  @ApiUnauthorizedResponse({
    description: 'Access token is missing or invalid.',
  })
  @ApiForbiddenResponse({
    description: 'The caller lacks user:manage permission.',
  })
  @ApiConflictResponse({
    description:
      'Username or email already exists, or account changed concurrently.',
  })
  async create(
    @Req() request: AuthenticatedHumanRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseRequest(request.body);
    response.setHeader('Cache-Control', 'no-store');

    try {
      const user = await this.provisioning.createUser({
        actorUserId: request.user.userId,
        username: input.username,
        email: input.email,
        role: input.role,
        ...(input.display_name === undefined
          ? {}
          : { displayName: input.display_name }),
      });
      return {
        id: user.userId,
        username: user.username,
        email: user.email,
        display_name: user.displayName,
        role: user.role,
        additional_permissions: user.additionalPermissions,
        effective_permissions: user.effectivePermissions,
        status: user.status,
        must_change_password: user.mustChangePassword,
        created_at: user.createdAt.toISOString(),
        updated_at: user.updatedAt.toISOString(),
        temporary_password: user.temporaryPassword,
      };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('Username or email already exists');
      }
      if (error instanceof AuditSequenceConflictError) {
        throw new ConflictException('Account changed concurrently');
      }
      throw error;
    }
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

function parseRequest(input: unknown): z.infer<typeof createUserSchema> {
  try {
    return createUserSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestException({
        message: 'Invalid user creation request',
      });
    }
    throw error;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

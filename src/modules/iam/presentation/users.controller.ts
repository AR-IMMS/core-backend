import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import { createPaginatedResult } from '@platform/http/api/pagination/paginated-result';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '@platform/http/api/pagination/pagination.schema';
import { z, ZodError } from 'zod';

import { IAM_PERMISSION_CODES } from '../domain/permission-catalog';
import { IAM_ROLE_CODES } from '../domain/role-permissions';
import {
  AuditSequenceConflictError,
  UserProvisioningService,
} from '../application/user-provisioning.service';
import {
  LastActiveItAdminError,
  SelfDisableError,
  SelfUserPermissionChangeError,
  SelfUserRoleChangeError,
  UserAdministrationConflictError,
  UserAdministrationService,
  UserNotFoundError,
} from '../application/user-administration.service';
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

const profileSchema = z
  .object({
    username: z.string().trim().min(3).max(64).optional(),
    email: z.email().max(254).optional(),
    display_name: z.string().trim().max(128).nullable().optional(),
  })
  .strict()
  .refine((profile) => Object.keys(profile).length > 0);

const replaceRoleSchema = z.object({ role: z.enum(IAM_ROLE_CODES) }).strict();
const replacePermissionsSchema = z
  .object({
    permissions: z.array(z.enum(IAM_PERMISSION_CODES)).max(64),
  })
  .strict()
  .refine(
    (value) => new Set(value.permissions).size === value.permissions.length,
  );
const statusSchema = z
  .object({ status: z.enum(['ACTIVE', 'INACTIVE']) })
  .strict();
const userListQuerySchema = z.strictObject({
  page_size: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  cursor: z.string().trim().min(1).max(512).optional(),
});
const userIdSchema = z.string().trim().min(1).max(128);

const userSchema: SchemaObject = {
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
  ],
  properties: {
    id: { type: 'string' },
    username: { type: 'string' },
    email: { type: 'string', format: 'email' },
    display_name: { type: 'string', nullable: true },
    role: { type: 'string', enum: [...IAM_ROLE_CODES] },
    additional_permissions: { type: 'array', items: { type: 'string' } },
    effective_permissions: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    must_change_password: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

const createUserRequestSchema: SchemaObject = {
  type: 'object',
  required: ['username', 'email', 'role'],
  additionalProperties: false,
  properties: {
    username: { type: 'string', minLength: 3, maxLength: 64 },
    email: { type: 'string', format: 'email', maxLength: 254 },
    display_name: { type: 'string', minLength: 1, maxLength: 128 },
    role: { type: 'string', enum: [...IAM_ROLE_CODES] },
  },
};

const profileRequestSchema: SchemaObject = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    username: { type: 'string', minLength: 3, maxLength: 64 },
    email: { type: 'string', format: 'email', maxLength: 254 },
    display_name: { type: 'string', nullable: true, maxLength: 128 },
  },
};

const roleCatalogEntrySchema: SchemaObject = {
  type: 'object',
  required: ['code', 'description', 'permissions'],
  properties: {
    code: { type: 'string', enum: [...IAM_ROLE_CODES] },
    description: { type: 'string' },
    permissions: {
      type: 'array',
      items: { type: 'string', enum: [...IAM_PERMISSION_CODES] },
    },
  },
};

const permissionCatalogEntrySchema: SchemaObject = {
  type: 'object',
  required: ['code', 'capability'],
  properties: {
    code: { type: 'string', enum: [...IAM_PERMISSION_CODES] },
    capability: { type: 'string' },
  },
};

/** Admin-protected user directory and administration endpoints. */
@ApiTags('IAM Users')
@ApiBearerAuth('HumanAccessToken')
@ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.' })
@ApiForbiddenResponse({
  description: 'The caller lacks the required permission.',
})
@Controller('users')
export class UsersController {
  constructor(
    private readonly provisioning: UserProvisioningService,
    @Optional() private readonly administration?: UserAdministrationService,
  ) {}

  @Post()
  @RequirePermissions('user:manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Provision a user account' })
  @ApiBody({ schema: createUserRequestSchema })
  @ApiCreatedResponse({
    description:
      'User created; generated temporary password is returned once. Response is no-store.',
    schema: singleResponseSchema({
      ...userSchema,
      required: [...(userSchema.required ?? []), 'temporary_password'],
      properties: {
        ...userSchema.properties,
        temporary_password: {
          type: 'string',
          description: 'One-time credential; never persist or log it.',
        },
      },
    }),
  })
  @ApiBadRequestResponse({ description: 'User request is invalid.' })
  @ApiConflictResponse({
    description:
      'Username or email already exists, or account changed concurrently.',
  })
  async create(
    @Req() request: AuthenticatedHumanRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parse(
      createUserSchema,
      request.body,
      'Invalid user creation request',
    );
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
      if (isDuplicateKeyError(error))
        throw new ConflictException('Username or email already exists');
      if (error instanceof AuditSequenceConflictError)
        throw new ConflictException('Account changed concurrently');
      throw error;
    }
  }

  @Get()
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'List human users' })
  @ApiQuery({
    name: 'page_size',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_PAGE_SIZE,
      default: DEFAULT_PAGE_SIZE,
    },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    schema: { type: 'string', maxLength: 512 },
  })
  @ApiOkResponse({
    description: 'A cursor-paginated page of users.',
    schema: listResponseSchema(userSchema),
  })
  @ApiBadRequestResponse({
    description: 'User list cursor or page size is invalid.',
  })
  list(@Query() rawQuery: Record<string, unknown>) {
    const query = parse(
      userListQuerySchema,
      rawQuery,
      'Invalid user list query',
    );
    const afterUserId = query.cursor
      ? decodeUserCursor(query.cursor)
      : undefined;
    return this.admin()
      .listUsers({ pageSize: query.page_size, afterUserId })
      .then((page) =>
        createPaginatedResult(page.users.map(serializeUser), {
          type: 'cursor',
          next_cursor: page.nextCursorUserId
            ? encodeUserCursor(page.nextCursorUserId)
            : null,
        }),
      );
  }

  @Get(':user_id')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'Get a user' })
  @ApiParam({
    name: 'user_id',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  @ApiOkResponse({
    description: 'User details.',
    schema: singleResponseSchema(userSchema),
  })
  @ApiNotFoundResponse({ description: 'User not found.' })
  @ApiBadRequestResponse({ description: 'User ID is invalid.' })
  async get(@Param('user_id') rawUserId: string) {
    const user = await this.admin().getUser(
      parse(userIdSchema, rawUserId, 'Invalid user ID'),
    );
    if (!user) throw new NotFoundException('User not found');
    return serializeUser(user);
  }

  @Patch(':user_id')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Update allowlisted user profile fields' })
  @ApiParam({ name: 'user_id', required: true })
  @ApiBody({ schema: profileRequestSchema })
  @ApiOkResponse({
    description: 'Profile updated.',
    schema: singleResponseSchema(userSchema),
  })
  @ApiBadRequestResponse({
    description: 'Only username, email, and display_name are accepted.',
  })
  @ApiNotFoundResponse({ description: 'User not found.' })
  @ApiConflictResponse({
    description:
      'Username or email already exists, or account changed concurrently.',
  })
  async updateProfile(
    @Req() request: AuthenticatedHumanRequest,
    @Param('user_id') rawUserId: string,
  ) {
    const userId = parse(userIdSchema, rawUserId, 'Invalid user ID');
    const profile = parse(
      profileSchema,
      request.body,
      'Invalid profile update request',
    );
    try {
      const user = await this.admin().updateProfile({
        actorUserId: request.user.userId,
        userId,
        ...(profile.username === undefined
          ? {}
          : { username: profile.username }),
        ...(profile.email === undefined ? {} : { email: profile.email }),
        ...(profile.display_name === undefined
          ? {}
          : { displayName: profile.display_name }),
      });
      return serializeUser(user);
    } catch (error) {
      this.mapAdministrationError(error);
    }
  }

  @Put(':user_id/role')
  @RequirePermissions('user:grant')
  @ApiOperation({ summary: "Replace a user's role" })
  @ApiParam({ name: 'user_id', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['role'],
      additionalProperties: false,
      properties: { role: { type: 'string', enum: [...IAM_ROLE_CODES] } },
    },
  })
  @ApiOkResponse({
    description: 'Role changed and additional permissions cleared.',
    schema: singleResponseSchema(userSchema),
  })
  @ApiBadRequestResponse({ description: 'Role request is invalid.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  @ApiConflictResponse({
    description:
      'Last active administrator protection or concurrent change conflict.',
  })
  async replaceRole(
    @Req() request: AuthenticatedHumanRequest,
    @Param('user_id') rawUserId: string,
  ) {
    const role = parse(
      replaceRoleSchema,
      request.body,
      'Invalid role replacement request',
    );
    try {
      return serializeUser(
        await this.admin().replaceRole({
          actorUserId: request.user.userId,
          userId: parse(userIdSchema, rawUserId, 'Invalid user ID'),
          role: role.role,
        }),
      );
    } catch (error) {
      this.mapAdministrationError(error);
    }
  }

  @Put(':user_id/additional-permissions')
  @RequirePermissions('user:grant')
  @ApiOperation({ summary: "Replace a user's additional permissions" })
  @ApiParam({ name: 'user_id', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['permissions'],
      additionalProperties: false,
      properties: {
        permissions: {
          type: 'array',
          maxItems: 64,
          uniqueItems: true,
          items: { type: 'string', enum: [...IAM_PERMISSION_CODES] },
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Additional permissions replaced.',
    schema: singleResponseSchema(userSchema),
  })
  @ApiBadRequestResponse({ description: 'Permission set is invalid.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  @ApiConflictResponse({ description: 'Concurrent user change conflict.' })
  async replaceAdditionalPermissions(
    @Req() request: AuthenticatedHumanRequest,
    @Param('user_id') rawUserId: string,
  ) {
    const input = parse(
      replacePermissionsSchema,
      request.body,
      'Invalid permission replacement request',
    );
    try {
      return serializeUser(
        await this.admin().replaceAdditionalPermissions({
          actorUserId: request.user.userId,
          userId: parse(userIdSchema, rawUserId, 'Invalid user ID'),
          permissions: input.permissions,
        }),
      );
    } catch (error) {
      this.mapAdministrationError(error);
    }
  }

  @Put(':user_id/status')
  @RequirePermissions('user:manage')
  @ApiOperation({ summary: 'Enable or disable a user' })
  @ApiParam({ name: 'user_id', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['status'],
      additionalProperties: false,
      properties: { status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } },
    },
  })
  @ApiOkResponse({
    description: 'User status changed.',
    schema: singleResponseSchema(userSchema),
  })
  @ApiBadRequestResponse({ description: 'Status request is invalid.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  @ApiConflictResponse({
    description:
      'Last active administrator protection or concurrent change conflict.',
  })
  async setStatus(
    @Req() request: AuthenticatedHumanRequest,
    @Param('user_id') rawUserId: string,
  ) {
    const input = parse(
      statusSchema,
      request.body,
      'Invalid user status request',
    );
    try {
      return serializeUser(
        await this.admin().setStatus({
          actorUserId: request.user.userId,
          userId: parse(userIdSchema, rawUserId, 'Invalid user ID'),
          status: input.status,
        }),
      );
    } catch (error) {
      this.mapAdministrationError(error);
    }
  }

  @Post(':user_id/reset-password')
  @RequirePermissions('user:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reset a user's password" })
  @ApiParam({ name: 'user_id', required: true })
  @ApiOkResponse({
    description:
      'Temporary credential returned once; all target sessions are revoked.',
    schema: singleResponseSchema({
      type: 'object',
      required: ['temporary_password', 'must_change_password'],
      properties: {
        temporary_password: { type: 'string' },
        must_change_password: { type: 'boolean', enum: [true] },
      },
    }),
  })
  @ApiNotFoundResponse({ description: 'User not found.' })
  @ApiBadRequestResponse({ description: 'User ID is invalid.' })
  @ApiConflictResponse({ description: 'Concurrent user change conflict.' })
  async resetPassword(
    @Req() request: AuthenticatedHumanRequest,
    @Param('user_id') rawUserId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const reset = await this.admin().resetPassword({
        actorUserId: request.user.userId,
        userId: parse(userIdSchema, rawUserId, 'Invalid user ID'),
      });
      return {
        temporary_password: reset.temporaryPassword,
        must_change_password: true,
      };
    } catch (error) {
      this.mapAdministrationError(error);
    }
  }

  @Post(':user_id/revoke-sessions')
  @RequirePermissions('user:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke all sessions for a user' })
  @ApiParam({ name: 'user_id', required: true })
  @ApiOkResponse({
    description: 'Matching active sessions were revoked.',
    schema: singleResponseSchema({
      type: 'object',
      required: ['revoked_count'],
      properties: { revoked_count: { type: 'integer', minimum: 0 } },
    }),
  })
  @ApiNotFoundResponse({ description: 'User not found.' })
  @ApiBadRequestResponse({ description: 'User ID is invalid.' })
  @ApiConflictResponse({ description: 'Concurrent user change conflict.' })
  async revokeSessions(
    @Req() request: AuthenticatedHumanRequest,
    @Param('user_id') rawUserId: string,
  ) {
    try {
      const result = await this.admin().revokeSessions({
        actorUserId: request.user.userId,
        userId: parse(userIdSchema, rawUserId, 'Invalid user ID'),
      });
      return { revoked_count: result.revokedCount };
    } catch (error) {
      this.mapAdministrationError(error);
    }
  }

  private admin(): UserAdministrationService {
    if (!this.administration)
      throw new Error('IAM administration provider is unavailable');
    return this.administration;
  }

  private mapAdministrationError(error: unknown): never {
    if (error instanceof UserNotFoundError)
      throw new NotFoundException('User not found');
    if (
      error instanceof UserAdministrationConflictError ||
      error instanceof LastActiveItAdminError
    ) {
      throw new ConflictException(error.message);
    }
    if (
      error instanceof SelfUserRoleChangeError ||
      error instanceof SelfUserPermissionChangeError ||
      error instanceof SelfDisableError
    ) {
      throw new ForbiddenException(error.message);
    }
    if (error instanceof Error && error.constructor === Error) {
      throw new BadRequestException({ message: error.message });
    }
    if (isDuplicateKeyError(error))
      throw new ConflictException('Username or email already exists');
    throw error;
  }
}

/** Fixed access-catalog endpoints; they expose no dynamic or Agent permissions. */
@ApiTags('IAM Access Catalog')
@ApiBearerAuth('HumanAccessToken')
@ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.' })
@ApiForbiddenResponse({ description: 'The caller lacks user:read permission.' })
@Controller('iam')
export class IamCatalogController {
  constructor(private readonly administration: UserAdministrationService) {}

  @Get('roles')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'List fixed system roles' })
  @ApiOkResponse({
    description: 'Fixed role catalog and role permission baselines.',
    schema: singleResponseSchema({
      type: 'array',
      items: roleCatalogEntrySchema,
    }),
  })
  listRoles() {
    return this.administration.listRoles();
  }

  @Get('permissions')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: 'List fixed system permissions' })
  @ApiOkResponse({
    description:
      'Fixed permission catalog. Agent Management permissions are not included.',
    schema: singleResponseSchema({
      type: 'array',
      items: permissionCatalogEntrySchema,
    }),
  })
  listPermissions() {
    return this.administration.listPermissions();
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

function listResponseSchema(item: SchemaObject): SchemaObject {
  return {
    type: 'object',
    required: ['data', 'meta', 'pagination'],
    properties: {
      data: { type: 'array', items: item },
      meta: {
        type: 'object',
        required: ['request_id'],
        properties: { request_id: { type: 'string' } },
      },
      pagination: {
        type: 'object',
        required: ['type', 'next_cursor'],
        properties: {
          type: { type: 'string', enum: ['cursor'] },
          next_cursor: { type: 'string', nullable: true },
        },
      },
    },
  };
}

function serializeUser(
  user: Awaited<ReturnType<UserAdministrationService['getUser']>> & object,
) {
  return {
    id: 'id' in user ? user.id : undefined,
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
  };
}

function parse<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  message: string,
): z.infer<TSchema> {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) throw new BadRequestException({ message });
    throw error;
  }
}

function encodeUserCursor(userId: string): string {
  return Buffer.from(JSON.stringify({ user_id: userId }), 'utf8').toString(
    'base64url',
  );
}

function decodeUserCursor(cursor: string): string {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      !('user_id' in parsed) ||
      typeof parsed.user_id !== 'string' ||
      parsed.user_id.trim().length === 0
    )
      throw new Error('invalid cursor');
    return parsed.user_id;
  } catch {
    throw new BadRequestException('User cursor is invalid');
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

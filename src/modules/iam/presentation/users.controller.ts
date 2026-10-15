import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';

import { IAM_ROLE_CODES } from '../domain/role-permissions';
import {
  AuditSequenceConflictError,
  UserProvisioningService,
} from '../application/user-provisioning.service';
import type { AuthenticatedHumanPrincipal } from '../application/ports/human-session-access.port';
import { HumanAccessGuard } from './human-access.guard';

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
@Controller('users')
@UseGuards(HumanAccessGuard)
export class UsersController {
  constructor(private readonly provisioning: UserProvisioningService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() request: AuthenticatedHumanRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.user.effectivePermissions.includes('user:manage')) {
      throw new ForbiddenException();
    }
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

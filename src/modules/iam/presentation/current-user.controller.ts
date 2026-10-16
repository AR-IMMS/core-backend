import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z, ZodError } from 'zod';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';

import type { AuthenticatedHumanPrincipal } from '../application/ports/human-session-access.port';
import { UserPresenceService } from '../application/user-presence.service';
import { HumanAccessGuard } from './human-access.guard';

interface AuthenticatedHumanRequest {
  readonly user: AuthenticatedHumanPrincipal;
}

const updatePresencePreferenceSchema = z
  .object({
    preference: z.enum(['AUTOMATIC', 'BUSY', 'AWAY']),
  })
  .strict();

/** Self-service principal and presence routes protected by IAM session auth. */
@ApiTags('IAM Current User')
@Controller('auth/me')
@UseGuards(HumanAccessGuard)
export class CurrentUserController {
  constructor(private readonly presence: UserPresenceService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the authenticated principal and effective permissions',
  })
  @ApiBearerAuth('HumanAccessToken')
  @ApiOkResponse({
    description: 'Current user profile and session-derived presence.',
    schema: singleResponseSchema({
      type: 'object',
      required: [
        'user_id',
        'username',
        'email',
        'role',
        'status',
        'effective_permissions',
        'must_change_password',
        'presence_status',
        'presence_preference',
      ],
      properties: {
        user_id: { type: 'string' },
        username: { type: 'string' },
        email: { type: 'string', format: 'email' },
        display_name: { type: 'string', nullable: true },
        role: { type: 'string', enum: ['IT_ADMIN', 'OPERATOR', 'TECHNICIAN'] },
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
        effective_permissions: { type: 'array', items: { type: 'string' } },
        must_change_password: { type: 'boolean' },
        presence_status: {
          type: 'string',
          enum: ['ONLINE', 'BUSY', 'AWAY', 'OFFLINE'],
        },
        presence_preference: {
          type: 'string',
          enum: ['AUTOMATIC', 'BUSY', 'AWAY'],
        },
      },
    }),
  })
  @ApiUnauthorizedResponse({
    description: 'Access token is missing or invalid.',
  })
  @ApiForbiddenResponse({
    description: 'A forced password change is required.',
  })
  async getCurrentUser(@Req() request: AuthenticatedHumanRequest) {
    const principal = this.requireFullyAuthenticated(request.user);
    const currentPresence = await this.presence.getPresence([principal.userId]);
    return {
      user_id: principal.userId,
      username: principal.username,
      email: principal.email,
      display_name: principal.displayName,
      role: principal.role,
      status: principal.status,
      effective_permissions: principal.effectivePermissions,
      must_change_password: principal.mustChangePassword,
      presence_status: currentPresence[0]?.status ?? 'OFFLINE',
      presence_preference: principal.presencePreference,
    };
  }

  @Post('presence/heartbeat')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Renew the current session presence lease' })
  @ApiBearerAuth('HumanAccessToken')
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Presence lease renewed.',
  })
  @ApiUnauthorizedResponse({
    description: 'Access token or session is invalid.',
  })
  @ApiForbiddenResponse({
    description: 'A forced password change is required.',
  })
  async heartbeat(@Req() request: AuthenticatedHumanRequest): Promise<void> {
    const principal = this.requireFullyAuthenticated(request.user);
    await this.presence.renewCurrentSessionLease({
      userId: principal.userId,
      sessionId: principal.sessionId,
    });
  }

  @Put('presence-preference')
  @ApiOperation({ summary: 'Set the authenticated user presence preference' })
  @ApiBearerAuth('HumanAccessToken')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['preference'],
      additionalProperties: false,
      properties: {
        preference: { type: 'string', enum: ['AUTOMATIC', 'BUSY', 'AWAY'] },
      },
    },
  })
  @ApiOkResponse({
    description: 'Presence preference updated.',
    schema: singleResponseSchema({
      type: 'object',
      required: ['presence_status', 'presence_preference'],
      properties: {
        presence_status: {
          type: 'string',
          enum: ['ONLINE', 'BUSY', 'AWAY', 'OFFLINE'],
        },
        presence_preference: {
          type: 'string',
          enum: ['AUTOMATIC', 'BUSY', 'AWAY'],
        },
      },
    }),
  })
  @ApiBadRequestResponse({ description: 'Presence preference is invalid.' })
  @ApiUnauthorizedResponse({
    description: 'Access token is missing or invalid.',
  })
  @ApiForbiddenResponse({
    description: 'A forced password change is required.',
  })
  async updatePresencePreference(
    @Req() request: AuthenticatedHumanRequest,
    @Body() body: unknown,
  ) {
    const principal = this.requireFullyAuthenticated(request.user);
    let preference: z.infer<
      typeof updatePresencePreferenceSchema
    >['preference'];
    try {
      preference = updatePresencePreferenceSchema.parse(body).preference;
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          message: 'Invalid presence preference',
        });
      }
      throw error;
    }
    const presence = await this.presence.setCurrentUserPreference(
      principal.userId,
      preference,
    );
    return {
      presence_status: presence.status,
      presence_preference: preference,
    };
  }

  private requireFullyAuthenticated(
    principal: AuthenticatedHumanPrincipal,
  ): AuthenticatedHumanPrincipal {
    if (principal.mustChangePassword) {
      throw new ForbiddenException('Password change is required');
    }
    return principal;
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

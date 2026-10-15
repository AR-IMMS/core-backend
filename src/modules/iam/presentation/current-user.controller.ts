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
@Controller('auth/me')
@UseGuards(HumanAccessGuard)
export class CurrentUserController {
  constructor(private readonly presence: UserPresenceService) {}

  @Get()
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
  async heartbeat(@Req() request: AuthenticatedHumanRequest): Promise<void> {
    const principal = this.requireFullyAuthenticated(request.user);
    await this.presence.renewCurrentSessionLease({
      userId: principal.userId,
      sessionId: principal.sessionId,
    });
  }

  @Put('presence-preference')
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

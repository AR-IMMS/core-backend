import {
  BadRequestException,
  Controller,
  ConflictException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z, ZodError } from 'zod';

import {
  AuthService,
  InvalidCredentialsError,
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

/** Native JSON token endpoints and session logout for IAM clients. */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly provisioning: UserProvisioningService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Req() request: { readonly body: unknown },
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseRequest(
      loginSchema,
      request.body,
      'Invalid login request',
    );
    response.setHeader('Cache-Control', 'no-store');
    try {
      return serializeTokenSet(
        await this.auth.login({
          identifier: input.identifier,
          password: input.password,
        }),
      );
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException('Invalid credentials');
      }
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: { readonly body: unknown },
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseRequest(
      refreshSchema,
      request.body,
      'Invalid refresh request',
    );
    response.setHeader('Cache-Control', 'no-store');
    try {
      return serializeTokenSet(await this.auth.refresh(input.refresh_token));
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException('Refresh token is invalid');
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(HumanAccessGuard)
  async logout(@Req() request: AuthenticatedHumanRequest): Promise<void> {
    await this.auth.logout(request.user.sessionId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(HumanAccessGuard)
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

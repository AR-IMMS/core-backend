import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpException,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z, ZodError } from 'zod';

import {
  AuthRateLimitExceededError,
  AuthService,
  InvalidCredentialsError,
  RefreshTokenReplayError,
} from '../application/auth.service';
import {
  IAM_BROWSER_AUTH_CONFIG,
  type BrowserAuthConfig,
} from './browser-auth-config.token';

const browserLoginSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254),
    password: z.string().min(1),
  })
  .strict();
const refreshCookieName = '__Secure-arimms_refresh';
const browserCookiePath = '/api/v1/auth/browser';

/** Dashboard cookie transport; native clients continue to use AuthController's JSON routes. */
@ApiTags('IAM Browser Authentication')
@Controller('auth/browser')
export class BrowserAuthController {
  private readonly logger = new Logger(BrowserAuthController.name);

  constructor(
    private readonly auth: AuthService,
    @Inject(IAM_BROWSER_AUTH_CONFIG) private readonly config: BrowserAuthConfig,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate Dashboard and set the refresh cookie',
  })
  @ApiHeader({
    name: 'Origin',
    required: true,
    description: 'Must exactly match a configured Dashboard origin.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['identifier', 'password'],
      additionalProperties: false,
      properties: {
        identifier: { type: 'string' },
        password: { type: 'string', writeOnly: true },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Access token and CSRF token returned; refresh token is set as an HttpOnly cookie.',
  })
  @ApiBadRequestResponse({ description: 'Invalid request body.' })
  @ApiForbiddenResponse({
    description: 'Origin is not configured for the Dashboard.',
  })
  @ApiUnauthorizedResponse({ description: 'Credentials are invalid.' })
  @ApiTooManyRequestsResponse({
    description: 'Authentication rate limit exceeded.',
  })
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseLogin(request.body);
    this.assertAllowedOrigin(request);
    response.setHeader('Cache-Control', 'no-store');
    try {
      await this.auth.checkLoginRateLimit(
        input.identifier,
        request.ip ?? 'unknown',
      );
      const tokenSet = await this.auth.login(input);
      response.cookie(
        refreshCookieName,
        tokenSet.refreshToken,
        this.cookieOptions(tokenSet.refreshExpiresAt),
      );
      return {
        access_token: tokenSet.accessToken,
        token_type: tokenSet.tokenType,
        expires_in: tokenSet.expiresIn,
        refresh_expires_at: tokenSet.refreshExpiresAt.toISOString(),
        must_change_password: tokenSet.mustChangePassword,
        csrf_token: this.createCsrfToken(tokenSet.refreshToken),
      };
    } catch (error) {
      return this.mapAuthError(error, response, 'login');
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('BrowserRefreshCookie')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({
    name: 'Origin',
    required: true,
    description: 'Must exactly match a configured Dashboard origin.',
  })
  @ApiOperation({ summary: 'Rotate Dashboard refresh cookie' })
  @ApiOkResponse({
    description:
      'Access token and CSRF token returned; refresh cookie rotated.',
  })
  @ApiForbiddenResponse({ description: 'CSRF token or Origin is invalid.' })
  @ApiUnauthorizedResponse({
    description: 'Refresh credential is invalid or reused.',
  })
  @ApiTooManyRequestsResponse({
    description: 'Authentication rate limit exceeded.',
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertAllowedOrigin(request);
    const refreshToken = readCookie(request, refreshCookieName);
    this.assertCsrf(request, refreshToken);
    response.setHeader('Cache-Control', 'no-store');
    try {
      const tokenSet = await this.auth.refresh(
        refreshToken,
        request.ip ?? 'unknown',
      );
      response.cookie(
        refreshCookieName,
        tokenSet.refreshToken,
        this.cookieOptions(tokenSet.refreshExpiresAt),
      );
      return {
        access_token: tokenSet.accessToken,
        token_type: tokenSet.tokenType,
        expires_in: tokenSet.expiresIn,
        refresh_expires_at: tokenSet.refreshExpiresAt.toISOString(),
        csrf_token: this.createCsrfToken(tokenSet.refreshToken),
      };
    } catch (error) {
      return this.mapAuthError(error, response, 'refresh');
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('BrowserRefreshCookie')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({
    name: 'Origin',
    required: true,
    description: 'Must exactly match a configured Dashboard origin.',
  })
  @ApiOperation({
    summary: 'Revoke Dashboard refresh session and clear its cookie',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Session revoked and cookie expired.',
  })
  @ApiForbiddenResponse({ description: 'CSRF token or Origin is invalid.' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.assertAllowedOrigin(request);
    const refreshToken = readCookie(request, refreshCookieName);
    this.assertCsrf(request, refreshToken);
    response.setHeader('Cache-Control', 'no-store');
    await this.auth.logoutByRefreshToken(refreshToken);
    response.clearCookie(refreshCookieName, this.cookieOptions(new Date(0)));
    this.logger.log('iam.auth.logout.completed');
  }

  private assertAllowedOrigin(request: Request): void {
    const origin = request.header('origin');
    const allowed = this.config.allowedOrigins;
    if (!origin || !allowed.includes(origin)) {
      throw new ForbiddenException('Request origin is not allowed');
    }
    if (!this.config.csrfSecret) {
      throw new ServiceUnavailableException(
        'Browser authentication is not configured',
      );
    }
  }

  private assertCsrf(request: Request, refreshToken: string): void {
    const supplied = request.header('x-csrf-token') ?? '';
    const expected = this.createCsrfToken(refreshToken);
    const actualBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    if (
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      throw new ForbiddenException('CSRF validation failed');
    }
  }

  private createCsrfToken(refreshToken: string): string {
    const secret = this.config.csrfSecret;
    if (!secret)
      throw new ServiceUnavailableException(
        'Browser authentication is not configured',
      );
    return createHmac('sha256', secret)
      .update(refreshToken)
      .digest('base64url');
  }

  private cookieOptions(expires: Date) {
    const sameSite = this.config.cookieSameSite;
    return {
      httpOnly: true,
      secure: true,
      sameSite,
      path: browserCookiePath,
      expires,
    } as const;
  }

  private mapAuthError(
    error: unknown,
    response: Response,
    action: 'login' | 'refresh',
  ): never {
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
      } else if (action === 'login') {
        this.logger.warn('iam.auth.login.failed');
      }
      throw new UnauthorizedException('Invalid credentials');
    }
    throw error;
  }
}

function parseLogin(input: unknown): z.infer<typeof browserLoginSchema> {
  try {
    return browserLoginSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError)
      throw new BadRequestException({ message: 'Invalid login request' });
    throw error;
  }
}

function readCookie(request: Request, name: string): string {
  const prefix = `${name}=`;
  const value = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value || !/^[A-Za-z0-9_-]{32,}$/.test(value))
    throw new UnauthorizedException('Refresh credential is invalid');
  return value;
}

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';

import { PlatformConfigModule } from '@platform/config';
import { OUTBOX_WRITER_PORT, UNIT_OF_WORK_PORT } from '@platform/events';
import { IAM_USER_PRESENCE_PORT } from './application/ports/user-presence.port.token';
import { IAM_USER_PRESENCE_STORE } from './application/ports/user-presence-store.token';
import {
  IAM_HUMAN_AUTH_STORE,
  IAM_HUMAN_SESSION_STORE,
} from './application/ports/human-auth-store.token';
import { IAM_PASSWORD_HASHER } from './application/ports/password-hasher.token';
import { IAM_ACCESS_TOKEN_ISSUER } from './application/ports/access-token-issuer.token';
import {
  IAM_ACCESS_TOKEN_VERIFIER,
  IAM_HUMAN_SESSION_ACCESS,
} from './application/ports/human-session-access.token';
import { UserPresenceService } from './application/user-presence.service';
import { UserProvisioningService } from './application/user-provisioning.service';
import { AuthService } from './application/auth.service';
import {
  IAM_SESSION_MODEL,
  IamSessionSchema,
} from './infrastructure/mongodb/iam-session.schema';
import {
  IAM_USER_MODEL,
  IamUserSchema,
} from './infrastructure/mongodb/iam-user.schema';
import {
  MongoUserPresenceStore,
  type MongoUserPresenceModel,
  type MongoUserSessionModel,
} from './infrastructure/mongodb/mongo-user-presence.store';
import {
  MongoHumanSessionAccessStore,
  type MongoHumanSessionAccessModel,
  type MongoHumanSessionModel,
} from './infrastructure/mongodb/mongo-human-session-access.store';
import { JwtAccessTokenService } from './infrastructure/jwt/jwt-access-token.service';
import { Argon2PasswordHasher } from './infrastructure/crypto/argon2-password-hasher';
import {
  MongoHumanAuthStore,
  type MongoHumanAccountModel,
  type MongoHumanSessionModel as MongoHumanCredentialSessionModel,
} from './infrastructure/mongodb/mongo-human-auth.store';
import { HumanAccessGuard } from './presentation/human-access.guard';
import { CurrentUserController } from './presentation/current-user.controller';
import { AuthController } from './presentation/auth.controller';
import { UsersController } from './presentation/users.controller';
import { BrowserAuthController } from './presentation/browser-auth.controller';
import { IAM_AUTH_RATE_LIMITER } from './application/ports/auth-rate-limiter.token';
import { InMemoryAuthRateLimiter } from './infrastructure/rate-limit/in-memory-auth-rate-limiter';
import { IAM_BROWSER_AUTH_CONFIG } from './presentation/browser-auth-config.token';
import { PermissionCatalogModule } from './permission-catalog.module';

/** Composes IAM-owned identity/presence persistence and public contracts. */
@Module({
  imports: [
    PlatformConfigModule,
    PermissionCatalogModule,
    JwtModule.registerAsync({
      imports: [PlatformConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        privateKey: config.get<string>('IAM_JWT_PRIVATE_KEY'),
        publicKey: config.get<string>('IAM_JWT_PUBLIC_KEY'),
        signOptions: {
          algorithm: 'RS256' as const,
          issuer: config.getOrThrow<string>('IAM_JWT_ISSUER'),
          audience: config.getOrThrow<string>('IAM_JWT_AUDIENCE'),
          expiresIn: config.get<number>('IAM_ACCESS_TOKEN_TTL_SECONDS', 900),
        },
        verifyOptions: {
          algorithms: ['RS256'] as const,
          issuer: config.getOrThrow<string>('IAM_JWT_ISSUER'),
          audience: config.getOrThrow<string>('IAM_JWT_AUDIENCE'),
        },
      }),
    }),
    MongooseModule.forFeature([
      { name: IAM_USER_MODEL, schema: IamUserSchema },
      { name: IAM_SESSION_MODEL, schema: IamSessionSchema },
    ]),
  ],
  controllers: [
    AuthController,
    BrowserAuthController,
    CurrentUserController,
    UsersController,
  ],
  providers: [
    { provide: IAM_AUTH_RATE_LIMITER, useClass: InMemoryAuthRateLimiter },
    {
      provide: IAM_BROWSER_AUTH_CONFIG,
      useFactory: (config: ConfigService) => ({
        allowedOrigins: (
          config.get<string>('IAM_BROWSER_ALLOWED_ORIGINS') ?? ''
        )
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
        csrfSecret: config.get<string>('IAM_BROWSER_CSRF_SECRET'),
        cookieSameSite: config.get<'lax' | 'none'>(
          'IAM_BROWSER_COOKIE_SAME_SITE',
          'lax',
        ),
      }),
      inject: [ConfigService],
    },
    {
      provide: IAM_USER_PRESENCE_STORE,
      useFactory: (
        userModel: MongoUserPresenceModel,
        sessionModel: MongoUserSessionModel,
      ) => new MongoUserPresenceStore(userModel, sessionModel),
      inject: [getModelToken(IAM_USER_MODEL), getModelToken(IAM_SESSION_MODEL)],
    },
    {
      provide: UserPresenceService,
      useFactory: (
        store: ConstructorParameters<typeof UserPresenceService>[0],
        config: ConfigService,
      ) =>
        new UserPresenceService(
          store,
          config.get<number>('IAM_PRESENCE_LEASE_TTL_SECONDS', 90) * 1000,
        ),
      inject: [IAM_USER_PRESENCE_STORE, ConfigService],
    },
    {
      provide: IAM_USER_PRESENCE_PORT,
      useExisting: UserPresenceService,
    },
    {
      provide: IAM_HUMAN_SESSION_ACCESS,
      useFactory: (
        userModel: MongoHumanSessionAccessModel,
        sessionModel: MongoHumanSessionModel,
      ) => new MongoHumanSessionAccessStore(userModel, sessionModel),
      inject: [getModelToken(IAM_USER_MODEL), getModelToken(IAM_SESSION_MODEL)],
    },
    {
      provide: IAM_HUMAN_AUTH_STORE,
      useFactory: (
        userModel: MongoHumanAccountModel,
        sessionModel: MongoHumanCredentialSessionModel,
      ) => new MongoHumanAuthStore(userModel, sessionModel),
      inject: [getModelToken(IAM_USER_MODEL), getModelToken(IAM_SESSION_MODEL)],
    },
    {
      provide: IAM_HUMAN_SESSION_STORE,
      useExisting: IAM_HUMAN_AUTH_STORE,
    },
    {
      provide: IAM_ACCESS_TOKEN_VERIFIER,
      useFactory: (jwt: JwtService, config: ConfigService) =>
        new JwtAccessTokenService(
          jwt,
          config.getOrThrow<string>('IAM_JWT_ISSUER'),
          config.getOrThrow<string>('IAM_JWT_AUDIENCE'),
        ),
      inject: [JwtService, ConfigService],
    },
    {
      provide: IAM_ACCESS_TOKEN_ISSUER,
      useExisting: IAM_ACCESS_TOKEN_VERIFIER,
    },
    {
      provide: IAM_PASSWORD_HASHER,
      useClass: Argon2PasswordHasher,
    },
    {
      provide: UserProvisioningService,
      useFactory: (
        users: ConstructorParameters<typeof UserProvisioningService>[0],
        passwords: ConstructorParameters<typeof UserProvisioningService>[1],
        unitOfWork: ConstructorParameters<typeof UserProvisioningService>[2],
        outbox: ConstructorParameters<typeof UserProvisioningService>[3],
      ) => new UserProvisioningService(users, passwords, unitOfWork, outbox),
      inject: [
        IAM_HUMAN_AUTH_STORE,
        IAM_PASSWORD_HASHER,
        UNIT_OF_WORK_PORT,
        OUTBOX_WRITER_PORT,
      ],
    },
    {
      provide: AuthService,
      useFactory: (
        users: ConstructorParameters<typeof AuthService>[0],
        sessions: ConstructorParameters<typeof AuthService>[1],
        passwords: ConstructorParameters<typeof AuthService>[2],
        tokens: ConstructorParameters<typeof AuthService>[3],
        config: ConfigService,
        rateLimiter: ConstructorParameters<typeof AuthService>[9],
      ) =>
        new AuthService(
          users,
          sessions,
          passwords,
          tokens,
          config.get<number>('IAM_ACCESS_TOKEN_TTL_SECONDS', 900),
          config.get<number>('IAM_REFRESH_SESSION_TTL_SECONDS', 604_800),
          undefined,
          undefined,
          undefined,
          rateLimiter,
          config.get<number>('IAM_LOGIN_RATE_LIMIT_PER_MINUTE', 5),
          config.get<number>('IAM_REFRESH_RATE_LIMIT_PER_MINUTE', 30),
        ),
      inject: [
        IAM_HUMAN_AUTH_STORE,
        IAM_HUMAN_SESSION_STORE,
        IAM_PASSWORD_HASHER,
        IAM_ACCESS_TOKEN_ISSUER,
        ConfigService,
        IAM_AUTH_RATE_LIMITER,
      ],
    },
    HumanAccessGuard,
  ],
  exports: [IAM_USER_PRESENCE_PORT, PermissionCatalogModule],
})
export class IamModule {}

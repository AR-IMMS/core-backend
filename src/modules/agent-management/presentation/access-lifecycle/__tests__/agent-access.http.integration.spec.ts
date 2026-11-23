import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { HumanAccessGuard } from '@modules/iam/presentation/human-access.guard';
import { HumanPermissionGuard } from '@modules/iam/presentation/human-permission.guard';
import {
  IAM_ACCESS_TOKEN_VERIFIER,
  IAM_HUMAN_SESSION_ACCESS,
} from '@modules/iam/application/ports/human-session-access.token';
import { IAM_PERMISSION_CATALOG_PORT } from '@modules/iam/application/ports/permission-catalog.token';
import { RevokeAgentBindingUseCase } from '../../../application/access-lifecycle/use-cases/revoke-agent-binding.use-case';
import { AgentBindingRevocationController } from '../agent-binding-revocation.controller';

describe('Agent authentication and Admin revocation HTTP boundaries', () => {
  let app: INestApplication;
  const revoke = { execute: jest.fn().mockResolvedValue(undefined) };
  const tokenVerifier = {
    verifyAccessToken: jest.fn((token: string) =>
      Promise.resolve(
        token.startsWith('human-')
          ? { userId: token, sessionId: `${token}-session` }
          : null,
      ),
    ),
  };
  const sessionAccess = {
    getActivePrincipal: jest.fn((userId: string, sessionId: string) =>
      Promise.resolve({
        userId,
        sessionId,
        role: 'IT_ADMIN' as const,
        status: 'ACTIVE' as const,
        mustChangePassword: false,
        username: userId,
        email: `${userId}@example.test`,
        displayName: null,
        effectivePermissions: userId === 'human-admin' ? ['agent:manage'] : [],
        presencePreference: 'AUTOMATIC' as const,
      }),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentBindingRevocationController],
      providers: [
        { provide: RevokeAgentBindingUseCase, useValue: revoke },
        { provide: IAM_ACCESS_TOKEN_VERIFIER, useValue: tokenVerifier },
        { provide: IAM_HUMAN_SESSION_ACCESS, useValue: sessionAccess },
        {
          provide: IAM_PERMISSION_CATALOG_PORT,
          useValue: { isKnownPermissionCode: () => true },
        },
        HumanAccessGuard,
        HumanPermissionGuard,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalGuards(
      app.get(HumanAccessGuard),
      app.get(HumanPermissionGuard),
    );
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('does not accept an Agent credential on the Human Admin revoke route', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/agent-bindings/binding-1/revoke')
      .set('Authorization', 'Bearer opaque-agent-secret')
      .expect(401);

    expect(revoke.execute).not.toHaveBeenCalled();
  });

  it('requires agent:manage and returns an empty 204 for authorized Admin revoke', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/agent-bindings/binding-1/revoke')
      .set('Authorization', 'Bearer human-operator')
      .expect(403);
    expect(revoke.execute).not.toHaveBeenCalled();

    const response = await request(app.getHttpServer() as Server)
      .post(
        '/api/v1/agent-bindings/e9a95012-1c46-4e85-97a0-a6b909b5c935/revoke',
      )
      .set('Authorization', 'Bearer human-admin')
      .expect(204);

    expect(response.text).toBe('');
    expect(revoke.execute).toHaveBeenCalledWith({
      bindingId: 'e9a95012-1c46-4e85-97a0-a6b909b5c935',
      actorId: 'human-admin',
    });
  });
});

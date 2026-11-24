import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { Server } from 'node:http';
import request from 'supertest';
import { CoreZodValidationPipe } from '@platform/http/validation/zod-validation.pipe';
import { ApiResponseInterceptor } from '@platform/http/api';
import { HumanAccessGuard } from '@modules/iam/presentation/human-access.guard';
import { HumanPermissionGuard } from '@modules/iam/presentation/human-permission.guard';
import {
  IAM_ACCESS_TOKEN_VERIFIER,
  IAM_HUMAN_SESSION_ACCESS,
} from '@modules/iam/application/ports/human-session-access.token';
import { IAM_PERMISSION_CATALOG_PORT } from '@modules/iam/application/ports/permission-catalog.token';
import { AgentRegistryController } from '../agent-registry.controller';
import { GetAgentInstallationUseCase } from '../../../application/agent-registry/use-cases/get-agent-installation.use-case';
import { ListAgentInstallationsUseCase } from '../../../application/agent-registry/use-cases/list-agent-installations.use-case';
import { ListInstallationBindingsUseCase } from '../../../application/agent-registry/use-cases/list-installation-bindings.use-case';

const INSTALLATION_ID = '5baf0cba-cf5a-4d39-a3d4-e76263b70810';
const NODE_ID = 'bb33fab0-c664-4a53-a813-72d7a2aac8c7';

@Controller('human-probe')
class HumanProbeController {
  @Get()
  get() {
    return { ok: true };
  }
}

describe('Agent Registry HTTP routes', () => {
  let app: INestApplication;
  const list = { execute: jest.fn() };
  const detail = { execute: jest.fn() };
  const history = { execute: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentRegistryController, HumanProbeController],
      providers: [
        { provide: ListAgentInstallationsUseCase, useValue: list },
        { provide: GetAgentInstallationUseCase, useValue: detail },
        { provide: ListInstallationBindingsUseCase, useValue: history },
        {
          provide: IAM_ACCESS_TOKEN_VERIFIER,
          useValue: {
            verifyAccessToken: (token: string) =>
              Promise.resolve(
                token.startsWith('human-')
                  ? { userId: token, sessionId: `${token}-session` }
                  : null,
              ),
          },
        },
        {
          provide: IAM_HUMAN_SESSION_ACCESS,
          useValue: {
            getActivePrincipal: (userId: string, sessionId: string) =>
              Promise.resolve({
                userId,
                sessionId,
                role: 'IT_ADMIN' as const,
                status: 'ACTIVE' as const,
                mustChangePassword: false,
                username: userId,
                email: `${userId}@example.test`,
                displayName: null,
                effectivePermissions:
                  userId === 'human-admin' ? ['agent:manage'] : [],
                presencePreference: 'AUTOMATIC' as const,
              }),
          },
        },
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
    app.useGlobalPipes(new CoreZodValidationPipe());
    app.useGlobalGuards(
      app.get(HumanAccessGuard),
      app.get(HumanPermissionGuard),
    );
    app.useGlobalInterceptors(
      new ApiResponseInterceptor(
        new Reflector(),
        { getId: () => 'request-agent-registry-1' } as never,
        {
          logger: { isLevelEnabled: () => false },
          debug: () => undefined,
        } as never,
      ),
    );
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    list.execute.mockResolvedValue({
      items: [],
      nextCursorInstallationId: null,
    });
    detail.execute.mockResolvedValue(null);
    history.execute.mockResolvedValue(null);
  });

  it('requires Human IAM authentication and agent:manage', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/v1/agents')
      .expect(401);
    await request(app.getHttpServer() as Server)
      .get('/api/v1/agents')
      .set('Authorization', 'Bearer human-operator')
      .expect(403);
    expect(list.execute).not.toHaveBeenCalled();
  });

  it('lists installations with the standard envelope and validates filters', async () => {
    await request(app.getHttpServer() as Server)
      .get(`/api/v1/agents?page_size=1&node_id=${NODE_ID}`)
      .set('Authorization', 'Bearer human-admin')
      .expect(200)
      .expect((response) => {
        const body = asRecord(response.body);
        expect(body['data']).toEqual([]);
        expect(asRecord(body['pagination'])).toEqual({
          type: 'cursor',
          next_cursor: null,
        });
      });
    expect(list.execute).toHaveBeenCalledWith({
      pageSize: 1,
      afterInstallationId: undefined,
      nodeId: NODE_ID,
    });

    await request(app.getHttpServer() as Server)
      .get('/api/v1/agents?node_id=bad')
      .set('Authorization', 'Bearer human-admin')
      .expect(400);
  });

  it('returns installation details and binding history without sensitive fields', async () => {
    detail.execute.mockResolvedValue({
      installationId: INSTALLATION_ID,
      agentVersion: '0.1.4',
      environment: { os: 'linux', architecture: 'amd64' },
      metadata: { api_key: 'never-return-this' },
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      updatedAt: null,
      currentBinding: null,
    });
    await request(app.getHttpServer() as Server)
      .get(`/api/v1/agents/${INSTALLATION_ID}`)
      .set('Authorization', 'Bearer human-admin')
      .expect(200)
      .expect((response) => {
        const body = asRecord(response.body);
        const data = asRecord(body['data']);
        expect(data['installation_id']).toBe(INSTALLATION_ID);
        expect(data).not.toHaveProperty('metadata');
      });

    history.execute.mockResolvedValue({ items: [], nextCursor: null });
    await request(app.getHttpServer() as Server)
      .get(`/api/v1/agents/${INSTALLATION_ID}/bindings`)
      .set('Authorization', 'Bearer human-admin')
      .expect(200)
      .expect((response) => {
        const body = asRecord(response.body);
        expect(body['data']).toEqual([]);
        expect(asRecord(body['pagination'])['type']).toBe('cursor');
      });
  });

  it('returns 404 for unknown installations and 400 for malformed IDs', async () => {
    await request(app.getHttpServer() as Server)
      .get(`/api/v1/agents/${INSTALLATION_ID}`)
      .set('Authorization', 'Bearer human-admin')
      .expect(404);
    await request(app.getHttpServer() as Server)
      .get('/api/v1/agents/not-a-uuid')
      .set('Authorization', 'Bearer human-admin')
      .expect(400);
  });
});

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object response');
  }
  return value as Record<string, unknown>;
}

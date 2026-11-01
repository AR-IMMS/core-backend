import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { ClsService } from 'nestjs-cls';
import { CoreZodValidationPipe } from '@platform/http/validation/zod-validation.pipe';
import { ApiResponseInterceptor } from '@platform/http/api';
import { EnrollAgentUseCase } from '../../application/enroll-agent.use-case';
import { EnrollmentController } from '../enrollment.controller';

describe('EnrollmentController HTTP response contract', () => {
  let app: INestApplication;
  let recovered = false;
  const result = {
    enrollmentId: 'e4fdf407-96b1-4ff1-b659-c9cf4470b5f9',
    installationId: '5baf0cba-cf5a-4d39-a3d4-e76263b70810',
    binding: {
      id: 'e9a95012-1c46-4e85-97a0-a6b909b5c935',
      nodeId: 'a3cb4e2c-15c1-4c3d-8cc9-110a47ac7001',
      status: 'active',
    },
    accessToken: 'recovered-credential',
    controlPlane: {
      baseUrl: 'https://core.example.test/api/v1/agent-control',
      pollIntervalSeconds: 30,
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EnrollmentController],
      providers: [
        {
          provide: EnrollAgentUseCase,
          useValue: {
            execute: jest.fn(() => Promise.resolve({ ...result, recovered })),
          },
        },
        {
          provide: ClsService,
          useValue: { getId: () => 'request-enrollment-1' },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new CoreZodValidationPipe());
    app.useGlobalInterceptors(
      new ApiResponseInterceptor(
        new Reflector(),
        {
          getId: () => 'request-enrollment-1',
        } as never,
        {
          logger: { isLevelEnabled: () => false },
          debug: () => undefined,
        } as never,
      ),
    );
    await app.init();
  });

  afterAll(() => app.close());

  it('returns 201 for a new enrollment and 200 with the same response envelope for recovery', async () => {
    const payload = {
      bootstrap_token: 'arimms_bt_http-test',
      enrollment_attempt_id: 'd99c38f2-7668-4814-9e70-6416014f83fe',
      installation: { id: result.installationId },
      agent: { version: '0.1.4' },
      environment: { os: 'linux', architecture: 'amd64' },
    };
    const first = await request(app.getHttpServer() as Server)
      .post('/api/v1/agent-enrollments')
      .send(payload);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      data: {
        enrollment_id: result.enrollmentId,
        credential: { access_token: result.accessToken },
      },
      meta: { request_id: 'request-enrollment-1' },
    });

    recovered = true;
    const retry = await request(app.getHttpServer() as Server)
      .post('/api/v1/agent-enrollments')
      .send(payload);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
  });
});

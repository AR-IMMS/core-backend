import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';

import { CoreZodValidationPipe } from '@platform/http/validation/zod-validation.pipe';
import { UserProvisioningService } from '../application/user-provisioning.service';
import { UserAdministrationService } from '../application/user-administration.service';
import { UsersController } from './users.controller';

describe('UsersController strict Zod validation integration', () => {
  let app: INestApplication;
  const administration = {
    listUsers: jest.fn().mockResolvedValue({
      users: [],
      nextCursorUserId: null,
    }),
    getUser: jest.fn().mockResolvedValue(null),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UserProvisioningService, useValue: {} },
        { provide: UserAdministrationService, useValue: administration },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new CoreZodValidationPipe());
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(() => app.close());

  /** It validates the query through a declared Zod DTO before listing users. */
  test('lists users with the strict global validation pipe enabled', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/v1/users?page_size=2')
      .expect(200);

    expect(administration.listUsers).toHaveBeenCalledWith({ pageSize: 2 });
  });

  /** It rejects unknown query keys as a client error instead of a schema declaration 500. */
  test('rejects unknown user-list query parameters', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/v1/users?unexpected=value')
      .expect(400);
  });

  /** It validates the path ID through a declared Zod DTO and reaches user lookup. */
  test('gets a user with the strict global validation pipe enabled', async () => {
    await request(app.getHttpServer() as Server)
      .get('/api/v1/users/user-1')
      .expect(404);

    expect(administration.getUser).toHaveBeenCalledWith('user-1');
  });
});

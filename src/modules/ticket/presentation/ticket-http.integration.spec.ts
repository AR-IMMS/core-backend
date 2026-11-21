import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Reflector } from '@nestjs/core';
import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { CoreZodValidationPipe } from '@platform/http/validation/zod-validation.pipe';
import { HumanPermissionGuard } from '@modules/iam/presentation/human-permission.guard';
import { PermissionCatalogService } from '@modules/iam/application/permission-catalog.service';
import { getRolePermissions } from '@modules/iam/domain/role-permissions';
import { GetAuthorizedTicket } from '../application/get-authorized-ticket';
import { TicketWorkflow } from '../application/ticket-workflow';
import { TicketOperationError } from '../application/ticket-journal';
import { TicketController } from './ticket.controller';
import { TicketWorkflowController } from './ticket-workflow.controller';

const actor = '403678c5-a90b-4a06-9a7d-318f27a3c639';
const fixture = {
  externalTicketId: 10,
  number: '11010',
  title: 'Safe projection',
  stateId: 2,
  priorityId: 2,
  createdAt: '2026-11-20T00:00:00Z',
  updatedAt: '2026-11-20T00:01:00Z',
  groupId: 2,
  nativeOwnerId: 5,
  customerId: 7,
  businessOwner: { kind: 'reference', externalUserId: 4 },
};

describe('Public Ticket HTTP contract', () => {
  const execute = jest.fn();
  const responsibilities = jest.fn();
  const transition = jest.fn();
  const create = jest.fn();
  const reopen = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TicketController, TicketWorkflowController],
      providers: [
        { provide: GetAuthorizedTicket, useValue: { execute } },
        {
          provide: TicketWorkflow,
          useValue: { responsibilities, transition, create, reopen },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new CoreZodValidationPipe());
    app.useGlobalGuards(
      new HumanPermissionGuard(new Reflector(), new PermissionCatalogService()),
    );
    // Authentication itself is exercised by the live-session runner, not synthetic here.
    app.use((req: Request, _response: Response, next: NextFunction) => {
      const role =
        req.headers.authorization === 'Bearer fixture'
          ? 'OPERATOR'
          : req.headers.authorization === 'Bearer technician-fixture'
            ? 'TECHNICIAN'
            : undefined;
      if (role)
        Object.assign(req, {
          user: {
            userId: actor,
            role,
            status: 'ACTIVE',
            effectivePermissions: getRolePermissions(role),
          },
        });
      next();
    });
    await app.init();
  });
  beforeEach(() => jest.resetAllMocks());
  afterAll(() => app.close());

  function api() {
    return request(app.getHttpServer() as Server);
  }

  it('uses the work permission only for progress and internal Articles in guards and Swagger', () => {
    const swagger = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const routes = [
      ['status', '/{ticket_id}/status', 'post', 'ticket:work'],
      ['appendArticle', '/{ticket_id}/articles', 'post', 'ticket:work'],
      [
        'responsibilities',
        '/{ticket_id}/responsibilities',
        'patch',
        'ticket:manage',
      ],
      ['information', '/{ticket_id}', 'patch', 'ticket:manage'],
      ['setLinks', '/{ticket_id}/links', 'patch', 'ticket:manage'],
      ['reopen', '/{ticket_id}/reopen', 'post', 'ticket:manage'],
      ['close', '/{ticket_id}/close', 'post', 'ticket:close'],
      ['create', '', 'post', 'ticket:create'],
    ] as const;
    const reflector = new Reflector();
    for (const [name, route, method, permission] of routes) {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        TicketWorkflowController.prototype,
        name,
      )?.value;
      if (typeof handler !== 'function')
        throw new Error('Missing Ticket handler');
      expect(reflector.get(HTTP_ROUTE_POLICY_METADATA, handler)).toEqual({
        kind: 'permissions',
        permissions: [permission],
      });
      expect(swagger.paths['/api/v1/tickets' + route][method]).toMatchObject({
        'x-required-permissions': [permission],
      });
    }
  });

  it('uses the trusted request actor and returns only public detail fields', async () => {
    execute.mockResolvedValue({
      status: 'allowed',
      ticket: fixture,
      businessOwnerStatus: 'valid',
    });
    const result = await api()
      .get('/api/v1/tickets/10')
      .set('Authorization', 'Bearer fixture')
      .expect('cache-control', 'no-store')
      .expect(200);
    expect(result.body).toEqual({
      ticket_id: 10,
      number: '11010',
      title: 'Safe projection',
      state_id: 2,
      priority_id: 2,
      created_at: fixture.createdAt,
      updated_at: fixture.updatedAt,
    });
    expect(execute).toHaveBeenCalledWith(actor, 10);
  });

  it.each(['01', '1e2', '9007199254740992', '10?expand=true'])(
    'rejects invalid request without calling the Ticket query: %s',
    async (id) => {
      await api()
        .get(`/api/v1/tickets/${id}`)
        .set('Authorization', 'Bearer fixture')
        .expect(400);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('requires an authenticated principal and hides both inaccessible and missing Tickets', async () => {
    // This harness exercises the permission guard without the session guard.
    await api().get('/api/v1/tickets/10').expect(403);
    execute
      .mockResolvedValueOnce({ status: 'denied' })
      .mockResolvedValueOnce({ status: 'not_found' });
    const denied = await api()
      .get('/api/v1/tickets/10')
      .set('Authorization', 'Bearer fixture')
      .expect(404);
    const missing = await api()
      .get('/api/v1/tickets/10')
      .set('Authorization', 'Bearer fixture')
      .expect(404);
    expect(denied.body).toEqual(missing.body);
  });

  it('sanitizes dependencies and ambiguous outcomes', async () => {
    execute.mockRejectedValueOnce(new Error('sensitive upstream body'));
    const error = await api()
      .get('/api/v1/tickets/10')
      .set('Authorization', 'Bearer fixture')
      .expect(503);
    expect(error.text).not.toContain('sensitive');
    transition.mockRejectedValueOnce(new TicketOperationError('UNRESOLVED'));
    await api()
      .post('/api/v1/tickets/10/status')
      .set('Authorization', 'Bearer fixture')
      .set('Idempotency-Key', 'valid-operation-key-01')
      .send({ state: 'OPEN' })
      .expect(409);
  });

  it('requires a valid operation key and rejects raw upstream fields', async () => {
    await api()
      .patch('/api/v1/tickets/10/responsibilities')
      .set('Authorization', 'Bearer fixture')
      .set('Idempotency-Key', 'valid-operation-key-01')
      .send({ owner_id: 5 })
      .expect(400);
    await api()
      .patch('/api/v1/tickets/10/responsibilities')
      .set('Authorization', 'Bearer fixture')
      .send({ assignee_user_id: actor })
      .expect(400);
    expect(responsibilities).not.toHaveBeenCalled();
  });

  it('TC-WF04-03/06/08: blocks unauthorized create, self-assignment and reopen before workflow dispatch', async () => {
    const techCall = (method: 'post' | 'patch', path: string) =>
      api()
        [method](path)
        .set('Authorization', 'Bearer technician-fixture')
        .set('Idempotency-Key', 'valid-operation-key-01');
    await techCall('post', '/api/v1/tickets')
      .send({
        title: 'Fixture',
        description: 'Fixture note',
        priority_id: 2,
        business_owner_user_id: actor,
        assignee_user_id: actor,
      })
      .expect(403);
    await techCall('patch', '/api/v1/tickets/10/responsibilities')
      .send({ assignee_user_id: actor })
      .expect(403);
    await techCall('post', '/api/v1/tickets/10/reopen')
      .send({ reason: 'Fixture' })
      .expect(403);
    expect(create).not.toHaveBeenCalled();
    expect(responsibilities).not.toHaveBeenCalled();
    expect(reopen).not.toHaveBeenCalled();
  });

  it('TC-WF04-19: rejects terminal state through the progress DTO before dispatch', async () => {
    await api()
      .post('/api/v1/tickets/10/status')
      .set('Authorization', 'Bearer technician-fixture')
      .set('Idempotency-Key', 'valid-operation-key-02')
      .send({ state: 'CLOSED' })
      .expect(400);
    expect(transition).not.toHaveBeenCalled();
  });
});

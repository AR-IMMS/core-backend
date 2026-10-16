import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';

import type { AuditEventPage, AuditRecordView } from '../domain/audit-query';
import { GetAuditEventUseCase } from '../application/get-audit-event.use-case';
import { ListAuditEventsUseCase } from '../application/list-audit-events.use-case';
import { AuditController } from './audit.controller';
import { HumanAccessGuard } from '@modules/iam/presentation/human-access.guard';
import { HumanPermissionGuard } from '@modules/iam/presentation/human-permission.guard';
import { PermissionCatalogService } from '@modules/iam/application/permission-catalog.service';
import type {
  AccessTokenVerifierPort,
  HumanSessionAccessPort,
} from '@modules/iam/application/ports/human-session-access.port';

describe('AuditController read integration', () => {
  let app: INestApplication;
  const events: AuditRecordView[] = [
    {
      eventId: 'v1-event',
      eventType: 'user.updated',
      eventVersion: 1,
      producer: 'users',
      actor: { type: 'user', id: 'admin-1' },
      action: 'update',
      resource: { type: 'user', id: 'user-2' },
      occurredAt: new Date('2026-10-10T00:00:00.000Z'),
      recordedAt: new Date('2026-10-10T00:00:01.000Z'),
      context: {},
      changes: [{ field: 'display_name', before: 'Old', after: 'New' }],
    },
    {
      eventId: 'v2-event',
      eventType: 'user.permissions.changed',
      eventVersion: 2,
      producer: 'iam',
      actor: { type: 'user', id: 'admin-1' },
      action: 'permissions.change',
      resource: { type: 'user', id: 'user-2' },
      occurredAt: new Date('2026-10-09T00:00:00.000Z'),
      recordedAt: new Date('2026-10-09T00:00:01.000Z'),
      context: {},
      changes: [
        {
          field: 'additional_permissions',
          before: ['user:read'],
          after: ['user:read', 'audit:read'],
        },
      ],
    },
  ];

  beforeAll(async () => {
    const page: AuditEventPage = { items: events, nextCursor: null };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        {
          provide: ListAuditEventsUseCase,
          useValue: { execute: jest.fn().mockResolvedValue(page) },
        },
        {
          provide: GetAuditEventUseCase,
          useValue: {
            execute: jest.fn((id: string) =>
              Promise.resolve(
                events.find((item) => item.eventId === id) ?? null,
              ),
            ),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    const tokenVerifier: AccessTokenVerifierPort = {
      verifyAccessToken: (token) =>
        Promise.resolve(
          token === 'invalid'
            ? null
            : {
                userId: token === 'limited' ? 'limited-user' : 'admin-1',
                sessionId: 'session-1',
              },
        ),
    };
    const sessionAccess: HumanSessionAccessPort = {
      getActivePrincipal: (userId, sessionId) =>
        Promise.resolve({
          userId,
          role: userId === 'limited-user' ? 'OPERATOR' : 'IT_ADMIN',
          status: 'ACTIVE',
          sessionId,
          mustChangePassword: false,
          username: userId,
          email: `${userId}@example.test`,
          displayName: null,
          effectivePermissions:
            userId === 'limited-user' ? ['ticket:read'] : ['audit:read'],
          presencePreference: 'AUTOMATIC',
        }),
    };
    app.useGlobalGuards(
      new HumanAccessGuard(tokenVerifier, sessionAccess, new Reflector()),
      new HumanPermissionGuard(new Reflector(), new PermissionCatalogService()),
    );
    await app.init();
  });

  afterAll(() => app.close());

  /** It returns v1 scalar and v2 permission-array values with event versions intact. */
  test('lists v1 and v2 audit records without coercing changes', async () => {
    const response = await get('/api/v1/audit/events');
    expect(response.body.items).toHaveLength(2);
    expect(response.body.items[0]).toMatchObject({
      event_id: 'v1-event',
      event_schema_version: 1,
      changes: [{ field: 'display_name', before: 'Old', after: 'New' }],
    });
    expect(response.body.items[1]).toMatchObject({
      event_id: 'v2-event',
      event_schema_version: 2,
      changes: [
        {
          field: 'additional_permissions',
          before: ['user:read'],
          after: ['user:read', 'audit:read'],
        },
      ],
    });
  });

  /** It returns the requested v2 record through the single-event response envelope. */
  test('reads a single v2 event and preserves arrays', async () => {
    const response = await get('/api/v1/audit/events/v2-event');
    expect(response.body.changes[0].after).toEqual(['user:read', 'audit:read']);
  });

  /** It returns 401 when Audit has no valid IAM bearer principal. */
  test('requires a valid bearer principal before permission evaluation', async () => {
    const response = await get('/api/v1/audit/events', null);
    expect(response.status).toBe(401);
  });

  /** It returns 403 when an authenticated principal lacks audit:read. */
  test('denies an authenticated principal without audit:read', async () => {
    const response = await get('/api/v1/audit/events', 'limited');
    expect(response.status).toBe(403);
  });

  function get(
    path: string,
    token: string | null = 'authorized',
  ): Promise<{
    status: number;
    body: {
      items: Array<Record<string, unknown>>;
      changes: Array<{ after: unknown }>;
    };
  }> {
    let testRequest = request(app.getHttpServer() as Server).get(path);
    if (token)
      testRequest = testRequest.set('Authorization', `Bearer ${token}`);
    return new Promise((resolve, reject) => {
      testRequest.end((error, response) => {
        if (error) reject(new Error(String(error)));
        else resolve(response);
      });
    });
  }
});

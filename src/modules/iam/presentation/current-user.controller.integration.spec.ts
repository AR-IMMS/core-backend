import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';

import { UserPresenceService } from '../application/user-presence.service';
import type { AuthenticatedHumanPrincipal } from '../application/ports/human-session-access.port';
import { CurrentUserController } from './current-user.controller';
import { HumanAccessGuard } from './human-access.guard';

describe('CurrentUserController presence integration', () => {
  let app: INestApplication;
  let principal: AuthenticatedHumanPrincipal;
  const presence = {
    getPresence: jest
      .fn()
      .mockResolvedValue([{ userId: 'u-1', status: 'ONLINE' }]),
    renewCurrentSessionLease: jest.fn().mockResolvedValue(undefined),
    setCurrentUserPreference: jest
      .fn()
      .mockImplementation((_userId: string, preference: string) =>
        Promise.resolve({ userId: 'u-1', status: 'BUSY', preference }),
      ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CurrentUserController],
      providers: [{ provide: UserPresenceService, useValue: presence }],
    })
      .overrideGuard(HumanAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(
      (
        req: { user?: AuthenticatedHumanPrincipal },
        _res: unknown,
        next: () => void,
      ) => {
        req.user = principal;
        next();
      },
    );
    await app.init();
  });

  beforeEach(() => {
    principal = {
      userId: 'u-1',
      username: 'operator',
      email: 'operator@example.test',
      displayName: null,
      role: 'OPERATOR',
      status: 'ACTIVE',
      sessionId: 's-1',
      mustChangePassword: false,
      effectivePermissions: ['ticket:read'],
      presencePreference: 'AUTOMATIC',
    };
    jest.clearAllMocks();
  });

  afterAll(() => app.close());

  /** It returns the current principal with effective presence and saved preference. */
  test('returns current presence in the current-principal representation', async () => {
    const response = await send('get', '/api/v1/auth/me').expect(200);

    expect(response.body).toMatchObject({
      user_id: 'u-1',
      presence_status: 'ONLINE',
      presence_preference: 'AUTOMATIC',
    });
    expect(presence.getPresence).toHaveBeenCalledWith(['u-1']);
  });

  /** It renews only the verified current session and returns no response body. */
  test('renews the current session lease with a 204 response', async () => {
    await send('post', '/api/v1/auth/me/presence/heartbeat').expect(204);

    expect(presence.renewCurrentSessionLease).toHaveBeenCalledWith({
      userId: 'u-1',
      sessionId: 's-1',
    });
  });

  /** It accepts only user-selectable preferences and returns the standard payload shape. */
  test('updates the authenticated user preference', async () => {
    const response = await send('put', '/api/v1/auth/me/presence-preference')
      .send({ preference: 'BUSY' })
      .expect(200);

    expect(response.body).toEqual({
      presence_status: 'BUSY',
      presence_preference: 'BUSY',
    });
    expect(presence.setCurrentUserPreference).toHaveBeenCalledWith(
      'u-1',
      'BUSY',
    );
  });

  /** It rejects effective ONLINE/OFFLINE values and unknown request fields. */
  test.each([
    [{ preference: 'ONLINE' }],
    [{ preference: 'OFFLINE' }],
    [{ preference: 'AWAY', user_id: 'u-2' }],
  ])(
    'rejects an invalid or over-scoped preference request %j',
    async (body) => {
      await send('put', '/api/v1/auth/me/presence-preference')
        .send(body)
        .expect(400);
    },
  );

  /** It blocks presence operations while the principal must change a password. */
  test('requires first-use password change before presence operations', async () => {
    principal = { ...principal, mustChangePassword: true };

    await send('post', '/api/v1/auth/me/presence/heartbeat').expect(403);
  });

  function send(method: 'get' | 'post' | 'put', path: string) {
    return request(app.getHttpServer() as Server)[method](path);
  }
});

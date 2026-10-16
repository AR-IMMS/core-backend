import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';

import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api';
import type { UserProvisioningService } from '../application/user-provisioning.service';
import { UsersController } from './users.controller';

describe('UsersController', () => {
  /** It returns the one-time credential once and disables response caching. */
  test('creates a user for a principal with user:manage', async () => {
    const provisioning = {
      createUser: jest.fn().mockResolvedValue({
        userId: 'user-1',
        username: 'Operator',
        email: 'operator@example.test',
        displayName: null,
        role: 'OPERATOR',
        status: 'ACTIVE',
        additionalPermissions: [],
        effectivePermissions: ['ticket:read'],
        mustChangePassword: true,
        temporaryPassword: 'single-use-secret',
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
        updatedAt: new Date('2026-10-15T12:00:00.000Z'),
      }),
    };
    const controller = new UsersController(
      provisioning as unknown as UserProvisioningService,
    );
    const response = { setHeader: jest.fn() } as unknown as Response;

    const result = await controller.create(
      {
        user: {
          userId: 'admin-1',
          effectivePermissions: ['user:manage'],
        },
        body: {
          username: 'Operator',
          email: 'operator@example.test',
          role: 'OPERATOR',
        },
      } as never,
      response,
    );

    expect(result).toMatchObject({
      id: 'user-1',
      temporary_password: 'single-use-secret',
      must_change_password: true,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Jest inspects the mock function and never invokes it without its owner.
    expect(jest.mocked(response.setHeader)).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
    expect(provisioning.createUser.mock.calls).toContainEqual([
      {
        actorUserId: 'admin-1',
        username: 'Operator',
        email: 'operator@example.test',
        role: 'OPERATOR',
      },
    ]);
  });

  /** Declares user provisioning as an explicit user:manage capability route. */
  test('requires user:manage on the create route', () => {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      UsersController.prototype,
      'create',
    )?.value;
    expect(typeof handler).toBe('function');

    if (typeof handler === 'function') {
      expect(Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, handler)).toEqual({
        kind: 'permissions',
        permissions: ['user:manage'],
      });
    }
  });

  /** It rejects unknown body fields and malformed account values. */
  test('rejects invalid user creation payloads', async () => {
    const controller = new UsersController({
      createUser: jest.fn(),
    } as unknown as UserProvisioningService);

    await expect(
      controller.create(
        {
          user: { userId: 'admin-1', effectivePermissions: ['user:manage'] },
          body: {
            username: 'x',
            email: 'not-an-email',
            role: 'AGENT',
            password: 'unexpected',
          },
        } as never,
        { setHeader: jest.fn() } as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

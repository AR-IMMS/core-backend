import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';

import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api';
import type { UserProvisioningService } from '../application/user-provisioning.service';
import type { UserAdministrationService } from '../application/user-administration.service';
import { IamCatalogController, UsersController } from './users.controller';

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
    const setHeader = jest.fn();
    const response = { setHeader } as unknown as Response;

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

  /** Every administration route declares its least-privilege IAM capability. */
  test.each([
    ['list', 'permissions', ['user:read']],
    ['get', 'permissions', ['user:read']],
    ['updateProfile', 'permissions', ['user:manage']],
    ['replaceRole', 'permissions', ['user:grant']],
    ['replaceAdditionalPermissions', 'permissions', ['user:grant']],
    ['setStatus', 'permissions', ['user:manage']],
    ['resetPassword', 'permissions', ['user:manage']],
    ['revokeSessions', 'permissions', ['user:manage']],
  ] as const)(
    'declares the required policy on %s',
    (method, kind, permissions) => {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        UsersController.prototype,
        method,
      )?.value;
      expect(typeof handler).toBe('function');
      if (typeof handler === 'function') {
        expect(
          Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, handler),
        ).toEqual({ kind, permissions });
      }
    },
  );

  /** Profile requests reject privilege fields rather than silently applying them. */
  test('rejects privilege changes in a profile update body', async () => {
    const controller = new UsersController(
      { createUser: jest.fn() } as never,
      { updateProfile: jest.fn() } as unknown as UserAdministrationService,
    );

    await expect(
      controller.updateProfile(
        {
          user: { userId: 'admin-1' },
          body: { display_name: 'New', role: 'IT_ADMIN' },
        } as never,
        { user_id: 'user-2' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /** Temporary credentials are returned once with the no-store response header. */
  test('resets a target credential without allowing the response to be cached', async () => {
    const administration = {
      resetPassword: jest.fn().mockResolvedValue({
        temporaryPassword: 'one-time-secret',
        mustChangePassword: true,
      }),
    };
    const controller = new UsersController(
      { createUser: jest.fn() } as never,
      administration as unknown as UserAdministrationService,
    );
    const setHeader = jest.fn();
    const response = { setHeader } as unknown as Response;

    await expect(
      controller.resetPassword(
        { user: { userId: 'admin-1' }, body: undefined } as never,
        { user_id: 'user-2' },
        response,
      ),
    ).resolves.toEqual({
      temporary_password: 'one-time-secret',
      must_change_password: true,
    });
    expect(administration.resetPassword).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      userId: 'user-2',
    });
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  /** User listing rejects unsupported query parameters before reaching IAM. */
  test('rejects unknown user list query parameters', () => {
    const listUsers = jest.fn();
    const controller = new UsersController(
      { createUser: jest.fn() } as never,
      { listUsers } as unknown as UserAdministrationService,
    );

    expect(() =>
      controller.list({ page_size: '20', unexpected: 'value' }),
    ).toThrow(BadRequestException);
    expect(listUsers).not.toHaveBeenCalled();
  });

  /** Cursor decoding remains opaque at HTTP and produces the next cursor metadata. */
  test('uses the cursor page envelope for user directory responses', async () => {
    const listUsers = jest
      .fn()
      .mockResolvedValue({ users: [], nextCursorUserId: null });
    const controller = new UsersController(
      { createUser: jest.fn() } as never,
      { listUsers } as unknown as UserAdministrationService,
    );

    await expect(controller.list({ page_size: '10' })).resolves.toMatchObject({
      items: [],
      pagination: { type: 'cursor', next_cursor: null },
    });
    expect(listUsers).toHaveBeenCalledWith({
      pageSize: 10,
      afterUserId: undefined,
    });
  });

  /** The fixed IAM catalogs declare user:read access and expose explicit routes. */
  test.each([
    ['listRoles', ['user:read']],
    ['listPermissions', ['user:read']],
  ] as const)(
    'requires user:read on IAM catalog method %s',
    (method, permissions) => {
      const handler: unknown = Object.getOwnPropertyDescriptor(
        IamCatalogController.prototype,
        method,
      )?.value;
      expect(typeof handler).toBe('function');
      if (typeof handler === 'function') {
        expect(
          Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, handler),
        ).toEqual({
          kind: 'permissions',
          permissions,
        });
      }
    },
  );
});

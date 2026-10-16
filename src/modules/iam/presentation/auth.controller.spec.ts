import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthService } from '../application/auth.service';
import {
  AuditSequenceConflictError,
  CurrentPasswordMismatchError,
  UserProvisioningService,
} from '../application/user-provisioning.service';
import { AuthController } from './auth.controller';

describe('AuthController password change', () => {
  /** It completes forced first-use password change without asking for the temporary password. */
  test('changes a password using the authenticated user and session', async () => {
    const provisioning = {
      changePassword: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AuthController(
      {} as AuthService,
      provisioning as unknown as UserProvisioningService,
    );

    await expect(
      controller.changePassword({
        user: { userId: 'u-1', sessionId: 's-1' } as never,
        body: { new_password: 'correct horse battery staple' },
      }),
    ).resolves.toEqual({ changed: true });
    expect(provisioning.changePassword).toHaveBeenCalledWith({
      userId: 'u-1',
      sessionId: 's-1',
      newPassword: 'correct horse battery staple',
    });
  });

  /** It rejects short passwords and unknown input fields before calling IAM. */
  test.each([
    { new_password: 'short' },
    { new_password: 'correct horse battery staple', user_id: 'u-2' },
  ])('rejects invalid password-change payloads', async (body) => {
    const provisioning = { changePassword: jest.fn() };
    const controller = new AuthController(
      {} as AuthService,
      provisioning as unknown as UserProvisioningService,
    );

    await expect(
      controller.changePassword({
        user: { userId: 'u-1', sessionId: 's-1' } as never,
        body,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provisioning.changePassword).not.toHaveBeenCalled();
  });

  /** It maps credential and sequence conflicts to safe HTTP errors. */
  test.each([
    [new CurrentPasswordMismatchError(), UnauthorizedException],
    [new AuditSequenceConflictError(), ConflictException],
  ])(
    'maps password change failures without leaking details',
    async (error, expected) => {
      const provisioning = {
        changePassword: jest.fn().mockRejectedValue(error),
      };
      const controller = new AuthController(
        {} as AuthService,
        provisioning as unknown as UserProvisioningService,
      );

      await expect(
        controller.changePassword({
          user: { userId: 'u-1', sessionId: 's-1' } as never,
          body: {
            current_password: 'wrong',
            new_password: 'correct horse battery staple',
          },
        }),
      ).rejects.toBeInstanceOf(expected);
    },
  );
});

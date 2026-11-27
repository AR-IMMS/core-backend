import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api';
import { FleetEnrollmentSyncController } from '../fleet-enrollment-sync.controller';

describe('FleetEnrollmentSyncController', () => {
  test('requires the Agent Management capability on the HTTP route', () => {
    expect(
      Reflect.getMetadata(
        HTTP_ROUTE_POLICY_METADATA,
        getHandler(
          FleetEnrollmentSyncController.prototype,
          'synchronizeInvitation',
        ),
      ),
    ).toEqual({
      kind: 'permissions',
      permissions: ['agent:manage'],
    });
  });

  test('returns the Core binding ID needed by the human revocation endpoint', async () => {
    const synchronize = {
      execute: jest.fn().mockResolvedValue({
        operationId: 'operation-1',
        invitationId: 'e9a95012-1c46-4e85-97a0-a6b909b5c935',
        nodeId: 'node-1',
        status: 'BOUND',
        installationId: 'agent-1',
        bindingId: 'fleet:e9a95012-1c46-4e85-97a0-a6b909b5c935',
      }),
    };
    const controller = new FleetEnrollmentSyncController(synchronize as never);

    await expect(
      controller.synchronizeInvitation(
        { invitationId: 'e9a95012-1c46-4e85-97a0-a6b909b5c935' },
        {
          userId: 'admin-1',
          role: 'IT_ADMIN',
          status: 'ACTIVE',
          effectivePermissions: ['agent:manage'],
        },
        { id: 'request-1' },
      ),
    ).resolves.toMatchObject({
      status: 'BOUND',
      binding_id: 'fleet:e9a95012-1c46-4e85-97a0-a6b909b5c935',
    });
  });
});

function getHandler(target: object, propertyKey: string): object {
  const value: unknown = Object.getOwnPropertyDescriptor(
    target,
    propertyKey,
  )?.value;
  if (typeof value !== 'function') throw new Error('Test handler is missing');
  return value;
}

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
});

function getHandler(target: object, propertyKey: string): object {
  const value: unknown = Object.getOwnPropertyDescriptor(
    target,
    propertyKey,
  )?.value;
  if (typeof value !== 'function') throw new Error('Test handler is missing');
  return value;
}

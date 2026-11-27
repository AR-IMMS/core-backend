import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedHumanContext } from '@modules/iam/presentation/authorization.decorators';
import type { ServerResponse } from 'node:http';
import {
  HTTP_ROUTE_POLICY_METADATA,
  type HttpRoutePolicy,
} from '@platform/http/api';
import { FleetOperationPendingError } from '../../../application/enrollment/errors/fleet-operation-pending.error';
import { RequestFleetInvitationUseCase } from '../../../application/enrollment/request-fleet-invitation.use-case';
import { FleetInvitationController } from '../fleet-invitation.controller';

describe('FleetInvitationController', () => {
  const execute = jest.fn();
  const useCase = { execute } as unknown as RequestFleetInvitationUseCase;
  const setHeader = jest.fn();
  const response = { setHeader } as unknown as ServerResponse;
  const principal = { userId: 'verified-user' } as AuthenticatedHumanContext;
  let controller: FleetInvitationController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new FleetInvitationController(useCase);
  });

  test('uses the verified principal and request ID and prevents caching', async () => {
    execute.mockResolvedValue({
      operationId: 'op-1',
      invitationId: 'invite-1',
      nodeId: 'node-1',
      status: 'PENDING',
      expiresAt: new Date('2026-11-22T01:00:00Z'),
      invitationToken: 'one-time-secret',
    });

    await expect(
      controller.create(
        { nodeId: 'node-1' },
        'client-idempotency-key',
        principal,
        { id: 'http-request-1' },
        response,
      ),
    ).resolves.toMatchObject({
      operation_id: 'op-1',
      invitation_token: 'one-time-secret',
    });
    expect(execute).toHaveBeenCalledWith({
      nodeId: 'node-1',
      idempotencyKey: 'client-idempotency-key',
      actor: { actorId: 'verified-user', requestId: 'http-request-1' },
    });
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  test('requires the Agent Management capability on the HTTP route', () => {
    const policy = Reflect.getMetadata(
      HTTP_ROUTE_POLICY_METADATA,
      getHandler(FleetInvitationController.prototype, 'create'),
    ) as HttpRoutePolicy;

    expect(policy).toEqual({
      kind: 'permissions',
      permissions: ['agent:manage'],
    });
  });

  test('rejects a missing or malformed idempotency key before Fleet use', async () => {
    await expect(
      controller.create(
        { nodeId: 'node-1' },
        'short',
        principal,
        { id: 'request-1' },
        response,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });

  test('returns an operation ID for unresolved cross-system outcomes', async () => {
    execute.mockRejectedValue(
      new FleetOperationPendingError('op-1', 'FLEET_CREATE_UNKNOWN'),
    );

    await expect(
      controller.create(
        { nodeId: 'node-1' },
        'client-idempotency-key',
        principal,
        { id: 'request-1' },
        response,
      ),
    ).rejects.toMatchObject({
      constructor: ServiceUnavailableException,
      response: {
        code: 'FLEET_OPERATION_PENDING',
        operation_id: 'op-1',
      },
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

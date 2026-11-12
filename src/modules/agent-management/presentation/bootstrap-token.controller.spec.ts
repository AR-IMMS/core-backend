import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api';
import { BootstrapTokenController } from './bootstrap-token.controller';
import { AgentNodeNotEligibleError } from '../application/issue-bootstrap-token.use-case';

describe('BootstrapTokenController', () => {
  it('requires agent management permission', () => {
    const handler = getHandler(BootstrapTokenController.prototype, 'issue');
    expect(Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, handler)).toEqual({
      kind: 'permissions',
      permissions: ['agent:manage'],
    });
  });

  it('returns the token once in the standard response data and disables caching', async () => {
    const result = {
      tokenId: 'bt_1',
      bootstrapToken: 'arimms_bt_secret',
      nodeId: 'a3cb4e2c-15c1-4c3d-8cc9-110a47ac7001',
      expiresAt: new Date('2026-10-30T10:10:00Z'),
    };
    const useCase = { execute: jest.fn().mockResolvedValue(result) };
    const controller = new BootstrapTokenController(useCase as never);
    const response = { setHeader: jest.fn() };
    await expect(
      controller.issue(
        result.nodeId,
        { userId: 'admin' } as never,
        response as never,
      ),
    ).resolves.toEqual({
      token_id: 'bt_1',
      bootstrap_token: 'arimms_bt_secret',
      node_id: result.nodeId,
      expires_at: '2026-10-30T10:10:00.000Z',
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
  });

  it('maps an ineligible Node to a conflict without returning token data', async () => {
    const useCase = {
      execute: jest.fn().mockRejectedValue(new AgentNodeNotEligibleError()),
    };
    const controller = new BootstrapTokenController(useCase as never);
    await expect(
      controller.issue(
        'a3cb4e2c-15c1-4c3d-8cc9-110a47ac7001',
        { userId: 'admin' } as never,
        { setHeader: jest.fn() } as never,
      ),
    ).rejects.toMatchObject({ status: 409 });
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

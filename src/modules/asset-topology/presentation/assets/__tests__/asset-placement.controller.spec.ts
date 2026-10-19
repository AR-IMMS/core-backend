import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api/http-route-policy';
import { AssetPlacementConflictError } from '../../../application/placements/asset-placement-store.port';
import { AssetPlacementController } from '../asset-placement.controller';

describe('AssetPlacementController', () => {
  const params = { asset_id: 'asset-1' };
  const body = { rack_id: 'rack-1', u_position: 8 };
  const admin = { user: { userId: 'admin-1', role: 'IT_ADMIN' as const } };

  it('validates the request and dispatches placement for an IT Admin', async () => {
    const placements = {
      place: jest.fn().mockResolvedValue({
        assetId: 'asset-1',
        rackId: 'rack-1',
        uPosition: { value: 8 },
      }),
    };
    const controller = new AssetPlacementController(placements as never);

    await expect(controller.place(admin, params, body)).resolves.toEqual({
      asset_id: 'asset-1',
      rack_id: 'rack-1',
      u_position: 8,
    });
    expect(placements.place).toHaveBeenCalledWith(
      'asset-1',
      'rack-1',
      8,
      expect.objectContaining({ id: 'admin-1' }),
    );
    await expect(
      controller.place(admin, params, { ...body, ignored: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-admin actors and maps concurrent occupancy to HTTP 409', async () => {
    const placements = {
      place: jest.fn().mockRejectedValue(new AssetPlacementConflictError()),
    };
    const controller = new AssetPlacementController(placements as never);

    await expect(
      controller.place(
        { user: { userId: 'operator', role: 'OPERATOR' as const } },
        params,
        body,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.place(admin, params, body)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('requires asset:manage permission on placement mutation routes', () => {
    for (const route of ['place', 'move', 'unmap']) {
      const handler = Object.getOwnPropertyDescriptor(
        AssetPlacementController.prototype,
        route,
      )?.value as object;
      expect(Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, handler)).toEqual({
        kind: 'permissions',
        permissions: ['asset:manage'],
      });
    }
  });
});

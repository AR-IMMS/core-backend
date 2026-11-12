import { ForbiddenException } from '@nestjs/common';
import { AssetWriteController } from '../asset-write.controller';
import { updateAssetSchema } from '../asset-registry.schemas';
import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api/http-route-policy';

describe('AssetWriteController', () => {
  it('requires IT Admin before dispatching mutations', async () => {
    const register = { execute: jest.fn() };
    const update = { execute: jest.fn() };
    const getAsset = { execute: jest.fn() };
    const retire = { execute: jest.fn() };
    const controller = new AssetWriteController(
      register as never,
      update as never,
      getAsset as never,
      retire as never,
    );

    await expect(
      controller.create(
        { user: { userId: 'operator', role: 'OPERATOR' } },
        {
          name: 'Node',
          asset_type: 'NODE',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(register.execute).not.toHaveBeenCalled();
  });

  it('maps the public Asset Type enum to the stable catalog ID', async () => {
    const register = {
      execute: jest.fn().mockResolvedValue({
        id: 'asset-1',
        name: 'Node',
        assetTypeId: 'type-node',
        assetModelId: undefined,
        serialNumber: undefined,
        lifecycleState: 'ACTIVE',
      }),
    };
    const controller = new AssetWriteController(
      register as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.create(
        { user: { userId: 'admin-1', role: 'IT_ADMIN' } },
        { name: 'Node', asset_type: 'NODE' },
      ),
    ).resolves.toMatchObject({ id: 'asset-1', asset_type: 'NODE' });
    expect(register.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Node', assetTypeId: 'type-node' }),
      { type: 'user', id: 'admin-1' },
    );
  });

  it('preserves omitted patch values and forwards explicit null clears', () => {
    expect(updateAssetSchema.parse({ name: 'Node A' })).toEqual({
      name: 'Node A',
    });
    expect(
      updateAssetSchema.parse({
        model_id: null,
        manufacturer_serial_number: null,
      }),
    ).toEqual({
      model_id: null,
      manufacturer_serial_number: null,
    });
    expect(() =>
      updateAssetSchema.parse({ asset_type_id: 'type-other' }),
    ).toThrow();
  });

  it('requires the asset:manage capability on both mutation routes', () => {
    const createHandler = Object.getOwnPropertyDescriptor(
      AssetWriteController.prototype,
      'create',
    )?.value as object;
    const updateHandler = Object.getOwnPropertyDescriptor(
      AssetWriteController.prototype,
      'update',
    )?.value as object;
    const retireHandler = Object.getOwnPropertyDescriptor(
      AssetWriteController.prototype,
      'retire',
    )?.value as object;
    expect(
      Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, createHandler),
    ).toEqual({ kind: 'permissions', permissions: ['asset:manage'] });
    expect(
      Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, updateHandler),
    ).toEqual({ kind: 'permissions', permissions: ['asset:manage'] });
    expect(
      Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, retireHandler),
    ).toEqual({ kind: 'permissions', permissions: ['asset:manage'] });
    expect(Reflect.getMetadata('__httpCode__', retireHandler)).toBe(204);
  });

  it('requires an IT Admin and dispatches retirement by Asset ID', async () => {
    const retire = { execute: jest.fn().mockResolvedValue(undefined) };
    const controller = new AssetWriteController(
      {} as never,
      {} as never,
      {} as never,
      retire as never,
    );
    const assetId = '00000000-0000-4000-8000-000000000001';

    await expect(
      controller.retire(
        { user: { userId: 'operator', role: 'OPERATOR' } },
        { asset_id: assetId },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(retire.execute).not.toHaveBeenCalled();

    await expect(
      controller.retire(
        { user: { userId: 'admin-1', role: 'IT_ADMIN' } },
        { asset_id: assetId },
      ),
    ).resolves.toBeUndefined();
    expect(retire.execute).toHaveBeenCalledWith(assetId, {
      type: 'user',
      id: 'admin-1',
    });
  });
});

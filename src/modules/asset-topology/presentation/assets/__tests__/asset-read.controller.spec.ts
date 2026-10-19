import { BadRequestException } from '@nestjs/common';
import { AssetReadController } from '../asset-read.controller';

describe('AssetReadController', () => {
  it('serves the Asset query and rejects malformed cursors', async () => {
    const get = {
      execute: jest.fn().mockResolvedValue({
        id: 'asset-1',
        name: 'Node',
        assetTypeId: 'type-node',
        lifecycleState: 'ACTIVE',
        currentPlacement: null,
      }),
    };
    const list = {
      execute: jest
        .fn()
        .mockResolvedValue({ assets: [], nextCursorAssetId: 'asset-2' }),
    };
    const controller = new AssetReadController(get as never, list as never);

    await expect(
      controller.get({ asset_id: 'asset-1' }),
    ).resolves.toMatchObject({
      id: 'asset-1',
      asset_type_id: 'type-node',
      current_placement: null,
    });
    await expect(
      controller.list({ cursor: 'not-json' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts only cursor and page_size list query parameters', async () => {
    const controller = new AssetReadController(
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
    );
    await expect(controller.list({ filter: 'node' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

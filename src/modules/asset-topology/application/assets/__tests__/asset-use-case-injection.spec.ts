import { Test } from '@nestjs/testing';
import { OUTBOX_WRITER_PORT, UNIT_OF_WORK_PORT } from '@platform/events';
import { RegisterAssetUseCase } from '../asset-registration.use-case';
import { UpdateAssetUseCase } from '../asset-update.use-case';
import { ASSET_CATALOG_STORE, ASSET_STORE } from '../asset-store.token';
import { ASSET_CLOCK, ASSET_ID_GENERATOR } from '../asset-runtime.token';

describe('Asset write use case dependency injection', () => {
  it('resolves both write use cases from their declared port providers', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RegisterAssetUseCase,
        UpdateAssetUseCase,
        { provide: ASSET_STORE, useValue: {} },
        { provide: ASSET_CATALOG_STORE, useValue: {} },
        { provide: UNIT_OF_WORK_PORT, useValue: {} },
        { provide: OUTBOX_WRITER_PORT, useValue: {} },
        { provide: ASSET_CLOCK, useValue: () => new Date() },
        { provide: ASSET_ID_GENERATOR, useValue: () => 'id' },
      ],
    }).compile();

    expect(moduleRef.get(RegisterAssetUseCase)).toBeInstanceOf(
      RegisterAssetUseCase,
    );
    expect(moduleRef.get(UpdateAssetUseCase)).toBeInstanceOf(
      UpdateAssetUseCase,
    );
    await moduleRef.close();
  });
});

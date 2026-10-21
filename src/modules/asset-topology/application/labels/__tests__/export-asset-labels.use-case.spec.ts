/* eslint-disable @typescript-eslint/unbound-method -- Jest mocks are inspected as mock functions. */
import type {
  AssetTopologyAssetQueries,
  AssetTopologyRackQueries,
} from '../../../contracts';
import type { QrMappingUseCases } from '../../qr/qr-mapping.use-cases';
import type { LabelDocumentRendererPort } from '../label-document-renderer.port';
import { ExportAssetLabelsUseCase } from '../export-asset-labels.use-case';

describe('ExportAssetLabelsUseCase', () => {
  const assets = {
    getAsset: jest.fn(),
  } as unknown as jest.Mocked<AssetTopologyAssetQueries>;
  const racks = {
    getRack: jest.fn(),
  } as unknown as jest.Mocked<AssetTopologyRackQueries>;
  const qrMappings = {
    getActiveMapping: jest.fn(),
  } as unknown as jest.Mocked<QrMappingUseCases>;
  const renderer = {
    toPdf: jest.fn(),
    toSvg: jest.fn(),
  } as unknown as jest.Mocked<LabelDocumentRendererPort>;
  let useCase: ExportAssetLabelsUseCase;

  beforeEach(() => {
    jest.resetAllMocks();
    assets.getAsset.mockImplementation((id) =>
      Promise.resolve({
        id,
        name: 'Node Alpha',
        assetTypeId: 'node' as never,
        lifecycleState: 'ACTIVE',
        currentPlacement: { rackId: 'rack-1' as never, uPosition: 7 },
      }),
    );
    racks.getRack.mockImplementation((id) =>
      Promise.resolve({
        id,
        name: 'Core Rack',
        uCapacity: 42,
        currentLocation: {
          roomId: 'room-1' as never,
          column: 3,
          row: 2,
          rotation: 0,
        },
      }),
    );
    qrMappings.getActiveMapping.mockImplementation((type, id) =>
      Promise.resolve({
        id: `mapping-${id}`,
        value: `qr-${id}`,
        targetType: type,
        targetId: id,
        active: true,
      }),
    );
    renderer.toPdf.mockResolvedValue(new Uint8Array([1]));
    renderer.toSvg.mockResolvedValue('<svg/>');
    useCase = new ExportAssetLabelsUseCase(assets, racks, qrMappings, renderer);
  });

  it('exports a Rack QR, canonical identity, and confirmed map location as SVG', async () => {
    const result = await useCase.execute(
      { rackIds: ['rack-1'], assetIds: [] },
      'svg',
    );

    expect(renderer.toSvg).toHaveBeenCalledWith([
      expect.objectContaining({
        targetType: 'rack',
        targetId: 'rack-1',
        qrValue: 'qr-rack-1',
        title: 'Rack rack-1',
        detail: 'Room room-1 · Column 3 · Row 2',
      }),
    ]);
    expect(result).toEqual({ format: 'svg', bytes: '<svg/>' });
  });

  it('labels an unplaced Node as unassigned and never includes its IP', async () => {
    assets.getAsset.mockResolvedValue({
      id: 'asset-1',
      name: 'Node Alpha',
      assetTypeId: 'node' as never,
      lifecycleState: 'ACTIVE',
      currentPlacement: null,
    } as never);

    await useCase.execute({ rackIds: [], assetIds: ['asset-1'] }, 'pdf');

    expect(renderer.toPdf).toHaveBeenCalledWith([
      expect.objectContaining({
        targetType: 'asset',
        targetId: 'asset-1',
        qrValue: 'qr-asset-1',
        title: 'Node Alpha',
        detail: 'Unassigned',
      }),
    ]);
    expect(JSON.stringify(renderer.toPdf.mock.calls)).not.toContain('ip');
  });

  it('rejects empty and over-limit requests before querying targets', async () => {
    await expect(
      useCase.execute({ rackIds: [], assetIds: [] }, 'pdf'),
    ).rejects.toThrow('Select between 1 and 100 labels');
    await expect(
      useCase.execute(
        {
          rackIds: Array.from({ length: 101 }, (_, index) => `rack-${index}`),
          assetIds: [],
        },
        'pdf',
      ),
    ).rejects.toThrow('Select between 1 and 100 labels');
    expect(racks.getRack).not.toHaveBeenCalled();
  });

  it('rejects requests containing an unknown target or a target without active QR', async () => {
    assets.getAsset.mockResolvedValueOnce(null);
    await expect(
      useCase.execute({ rackIds: [], assetIds: ['missing'] }, 'pdf'),
    ).rejects.toThrow('Asset missing was not found');

    qrMappings.getActiveMapping.mockResolvedValueOnce(null);
    await expect(
      useCase.execute({ rackIds: ['rack-1'], assetIds: [] }, 'pdf'),
    ).rejects.toThrow('Rack rack-1 has no active QR mapping');
  });

  it('supports a mixed bulk selection and preserves the requested target order', async () => {
    await useCase.execute(
      { rackIds: ['rack-1'], assetIds: ['asset-1'] },
      'pdf',
    );

    expect(renderer.toPdf).toHaveBeenCalledWith([
      expect.objectContaining({ targetType: 'rack' }),
      expect.objectContaining({ targetType: 'asset' }),
    ]);
  });
});

/* eslint-disable @typescript-eslint/unbound-method -- Jest mocks are inspected as mock functions. */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LabelExportController } from '../label-export.controller';
import {
  ExportAssetLabelsUseCase,
  LabelExportTargetNotFoundError,
} from '../../../application/labels/export-asset-labels.use-case';

describe('LabelExportController', () => {
  const exports = {
    execute: jest.fn(),
  } as unknown as jest.Mocked<ExportAssetLabelsUseCase>;
  const response = {
    status: jest.fn(),
    set: jest.fn(),
    send: jest.fn(),
  };
  let controller: LabelExportController;

  beforeEach(() => {
    jest.resetAllMocks();
    response.status.mockReturnValue(response);
    response.set.mockReturnValue(response);
    response.send.mockReturnValue(response);
    controller = new LabelExportController(exports);
  });

  it('returns the requested PDF as an attachment for an IT Admin', async () => {
    exports.execute.mockResolvedValue({
      format: 'pdf',
      bytes: new Uint8Array([37, 80]),
    });

    await controller.export(
      { user: { role: 'IT_ADMIN' }, body: { asset_ids: ['asset-1'] } },
      'pdf',
      response as never,
    );

    expect(exports.execute).toHaveBeenCalledWith(
      { rackIds: [], assetIds: ['asset-1'] },
      'pdf',
    );
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="asset-labels.pdf"',
      }),
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from([37, 80]));
  });

  it('returns SVG with the SVG media type', async () => {
    exports.execute.mockResolvedValue({ format: 'svg', bytes: '<svg/>' });
    await controller.export(
      { user: { role: 'IT_ADMIN' }, body: { rack_ids: ['rack-1'] } },
      'svg',
      response as never,
    );
    expect(response.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Content-Type': 'image/svg+xml' }),
    );
    expect(response.send).toHaveBeenCalledWith('<svg/>');
  });

  it('rejects unauthorized roles, unsupported formats, invalid selections, and missing targets', async () => {
    await expect(
      controller.export(
        { user: { role: 'TECHNICIAN' }, body: { asset_ids: ['asset-1'] } },
        'pdf',
        response as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.export(
        { user: { role: 'IT_ADMIN' }, body: { asset_ids: ['asset-1'] } },
        'png',
        response as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.export(
        { user: { role: 'IT_ADMIN' }, body: {} },
        'pdf',
        response as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    exports.execute.mockRejectedValue(
      new LabelExportTargetNotFoundError('Rack', 'rack-404'),
    );
    await expect(
      controller.export(
        { user: { role: 'IT_ADMIN' }, body: { rack_ids: ['rack-404'] } },
        'pdf',
        response as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

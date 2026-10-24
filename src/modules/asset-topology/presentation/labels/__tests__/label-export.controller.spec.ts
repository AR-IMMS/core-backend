/* eslint-disable @typescript-eslint/unbound-method -- Jest mocks are inspected as mock functions. */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CoreZodValidationPipe } from '@platform/http/validation/zod-validation.pipe';
import { LabelExportController } from '../label-export.controller';
import {
  LabelExportFormatParamsDto,
  LabelExportRequestDto,
} from '../label-export.schemas';
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
      { user: { role: 'IT_ADMIN' } },
      { format: 'pdf' },
      { asset_ids: ['asset-1'] } as LabelExportRequestDto,
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

  it('publishes the label selection body in Swagger', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LabelExportController],
      providers: [
        { provide: ExportAssetLabelsUseCase, useValue: { execute: jest.fn() } },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('test').setVersion('1').build(),
      );
      const requestBody =
        document.paths['/api/v1/asset-topology/labels/{format}'].post
          ?.requestBody;
      const requestSchema = document.components?.schemas?.LabelExportRequestDto;

      expect(requestBody).toBeDefined();
      expect(JSON.stringify(requestBody)).toContain('application/json');
      expect(JSON.stringify(requestSchema)).toContain('rack_ids');
      expect(JSON.stringify(requestSchema)).toContain('asset_ids');
    } finally {
      await app.close();
    }
  });

  it('validates the label body through the global Zod pipe', () => {
    expect(
      new CoreZodValidationPipe().transform(
        { asset_ids: ['asset-1'] },
        { type: 'body', metatype: LabelExportRequestDto },
      ),
    ).toEqual({ rack_ids: [], asset_ids: ['asset-1'] });
  });

  it('returns SVG with the SVG media type', async () => {
    exports.execute.mockResolvedValue({ format: 'svg', bytes: '<svg/>' });
    await controller.export(
      { user: { role: 'IT_ADMIN' } },
      { format: 'svg' },
      { rack_ids: ['rack-1'] } as LabelExportRequestDto,
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
        { user: { role: 'TECHNICIAN' } },
        { format: 'pdf' },
        { asset_ids: ['asset-1'] } as LabelExportRequestDto,
        response as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => {
      new CoreZodValidationPipe().transform(
        { format: 'png' },
        { type: 'param', metatype: LabelExportFormatParamsDto },
      );
    }).toThrow(BadRequestException);
    await expect(
      controller.export(
        { user: { role: 'IT_ADMIN' } },
        { format: 'pdf' },
        {} as LabelExportRequestDto,
        response as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    exports.execute.mockRejectedValue(
      new LabelExportTargetNotFoundError('Rack', 'rack-404'),
    );
    await expect(
      controller.export(
        { user: { role: 'IT_ADMIN' } },
        { format: 'pdf' },
        { rack_ids: ['rack-404'] } as LabelExportRequestDto,
        response as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

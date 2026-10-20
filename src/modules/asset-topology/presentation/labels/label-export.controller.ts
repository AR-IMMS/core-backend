import {
  BadRequestException,
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '@modules/iam';
import type { RoleCode } from '@modules/iam';
import {
  ExportAssetLabelsUseCase,
  LabelExportQrNotFoundError,
  LabelExportRequestError,
  LabelExportTargetNotFoundError,
} from '../../application/labels/export-asset-labels.use-case';
import {
  LabelExportFormatParamsDto,
  parseLabelExportRequest,
} from './label-export.schemas';

interface LabelExportRequest {
  readonly user: { readonly role: RoleCode };
  readonly body: unknown;
}

@ApiTags('Asset Topology - Labels')
@ApiBearerAuth('HumanAccessToken')
@ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.' })
@ApiForbiddenResponse({ description: 'Only IT Admins can export labels.' })
@Controller('asset-topology/labels')
export class LabelExportController {
  constructor(private readonly exports: ExportAssetLabelsUseCase) {}

  @Post(':format')
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Export selected Rack and Node QR labels' })
  @ApiParam({ name: 'format', enum: ['pdf', 'svg'] })
  @ApiBadRequestResponse({
    description: 'Format or target selection is invalid.',
  })
  @ApiNotFoundResponse({
    description: 'A selected target or active QR was not found.',
  })
  async export(
    @Req() request: LabelExportRequest,
    @Param() formatParams: LabelExportFormatParamsDto,
    @Res() response: Response,
  ): Promise<void> {
    if (request.user.role !== 'IT_ADMIN') {
      throw new ForbiddenException('Only IT Admins can export labels.');
    }
    const formatValue = formatParams.format;
    const body = parseLabelExportRequest(request.body);
    try {
      const result = await this.exports.execute(
        { rackIds: body.rack_ids, assetIds: body.asset_ids },
        formatValue,
      );
      const contentType =
        result.format === 'pdf' ? 'application/pdf' : 'image/svg+xml';
      response
        .status(200)
        .set({
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="asset-labels.${result.format}"`,
          'Cache-Control': 'no-store',
        })
        .send(
          typeof result.bytes === 'string'
            ? result.bytes
            : Buffer.from(result.bytes),
        );
    } catch (error) {
      if (error instanceof LabelExportRequestError) {
        throw new BadRequestException(error.message);
      }
      if (
        error instanceof LabelExportTargetNotFoundError ||
        error instanceof LabelExportQrNotFoundError
      ) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}

import {
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RequirePermissions } from '@modules/iam';
import type { RoleCode } from '@modules/iam';
import {
  QrMappingNotFoundError,
  QrMappingTargetNotFoundError,
  QrMappingUseCases,
} from '../../application/qr/qr-mapping.use-cases';
import { QrMappingConflictError } from '../../application/qr/qr-mapping.errors';
import type { QrTargetType } from '../../application/qr/qr-mapping-store.port';

interface Request {
  readonly user: { readonly userId: string; readonly role: RoleCode };
  readonly requestId?: string;
}

const assetQrParamsSchema = z.strictObject({
  asset_id: z.string().trim().min(1).max(128),
});
const rackQrParamsSchema = z.strictObject({
  rack_id: z.string().trim().min(1).max(128),
});
const qrValueParamsSchema = z.strictObject({
  value: z.string().trim().min(1).max(128),
});

class AssetQrParamsDto extends createZodDto(assetQrParamsSchema) {}
class RackQrParamsDto extends createZodDto(rackQrParamsSchema) {}
class QrValueParamsDto extends createZodDto(qrValueParamsSchema) {}

@ApiTags('Asset Topology - QR')
@ApiBearerAuth('HumanAccessToken')
@Controller('asset-topology')
export class QrMappingController {
  constructor(private readonly mappings: QrMappingUseCases) {}

  @Post('assets/:asset_id/qr')
  @HttpCode(200)
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Generate or replace an Asset QR mapping' })
  @ApiParam({ name: 'asset_id', required: true, type: String })
  @ApiOkResponse({ description: 'New opaque QR mapping generated.' })
  assignAsset(@Req() request: Request, @Param() params: AssetQrParamsDto) {
    return this.mutate(request, 'asset', params.asset_id, false);
  }

  @Delete('assets/:asset_id/qr')
  @RequirePermissions('asset:manage')
  @ApiParam({ name: 'asset_id', required: true, type: String })
  deactivateAsset(@Req() request: Request, @Param() params: AssetQrParamsDto) {
    return this.mutate(request, 'asset', params.asset_id, true);
  }

  @Post('racks/:rack_id/qr')
  @HttpCode(200)
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Generate or replace a Rack QR mapping' })
  @ApiParam({ name: 'rack_id', required: true, type: String })
  @ApiOkResponse({ description: 'New opaque QR mapping generated.' })
  assignRack(@Req() request: Request, @Param() params: RackQrParamsDto) {
    return this.mutate(request, 'rack', params.rack_id, false);
  }

  @Delete('racks/:rack_id/qr')
  @RequirePermissions('asset:manage')
  @ApiParam({ name: 'rack_id', required: true, type: String })
  deactivateRack(@Req() request: Request, @Param() params: RackQrParamsDto) {
    return this.mutate(request, 'rack', params.rack_id, true);
  }

  @Get('qr/:value')
  @RequirePermissions('asset:read')
  @ApiOperation({
    summary: 'Resolve an active QR mapping to current target data',
  })
  @ApiParam({ name: 'value', required: true, type: String })
  @ApiOkResponse({ description: 'Current target data for the active mapping.' })
  @ApiNotFoundResponse({ description: 'No active mapping or target exists.' })
  async resolve(@Param() params: QrValueParamsDto) {
    const result = await this.mappings.resolve(params.value);
    if (!result) throw new NotFoundException('Active QR mapping was not found');
    return result;
  }

  private async mutate(
    request: Request,
    type: QrTargetType,
    id: string,
    deactivate: boolean,
  ) {
    if (request.user.role !== 'IT_ADMIN')
      throw new ForbiddenException('Only IT Admins can manage QR mappings.');
    const actor = {
      type: 'user',
      id: request.user.userId,
      context: request.requestId
        ? { request_id: request.requestId }
        : undefined,
    };
    try {
      if (deactivate) {
        await this.mappings.deactivate(type, id, actor);
        return { target_type: type, target_id: id, active: false };
      }
      const mapping = await this.mappings.assign(type, id, actor);
      return {
        target_type: type,
        target_id: id,
        qr_value: mapping.value,
        active: true,
      };
    } catch (error) {
      if (
        error instanceof QrMappingTargetNotFoundError ||
        error instanceof QrMappingNotFoundError
      )
        throw new NotFoundException(error.message);
      if (error instanceof QrMappingConflictError)
        throw new ConflictException(error.message);
      throw error;
    }
  }
}

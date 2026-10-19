import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermissions } from '@modules/iam';
import { DomainError } from '../../domain/shared/domain-error';
import {
  ActiveAssetPlacementNotFoundError,
  AssetPlacementConflictError,
} from '../../application/placements/asset-placement-store.port';
import { AssetReferenceNotFoundError } from '../../application/assets/asset-registration.use-case';
import { AssetPlacementManagementUseCases } from '../../application/placements/asset-placement-management.use-case';
import {
  assetPlacementParamsSchema,
  assetPlacementRequestSchema,
  parseAssetPlacementRequest,
} from './asset-placement.schemas';
import { requireAssetAdmin, type AssetHttpRequest } from './asset-http-support';

@ApiTags('Asset Placement')
@ApiBearerAuth('HumanAccessToken')
@ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.' })
@Controller('asset-topology/assets/:asset_id/placement')
export class AssetPlacementController {
  constructor(private readonly placements: AssetPlacementManagementUseCases) {}

  @Post()
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Place an unassigned Asset in a Rack U' })
  @ApiCreatedResponse({ description: 'Asset placement created.' })
  @ApiBadRequestResponse({ description: 'Placement request violates a rule.' })
  @ApiConflictResponse({ description: 'The Rack U was claimed concurrently.' })
  @ApiNotFoundResponse({ description: 'Asset or Rack was not found.' })
  place(
    @Req() request: AssetHttpRequest,
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
  ) {
    return this.execute(async () => {
      const params = parseAssetPlacementRequest(
        assetPlacementParamsSchema,
        rawParams,
        'Invalid Asset ID',
      );
      const body = parseAssetPlacementRequest(
        assetPlacementRequestSchema,
        rawBody,
        'Invalid Asset placement request',
      );
      const placement = await this.placements.place(
        params.asset_id,
        body.rack_id,
        body.u_position,
        requireAssetAdmin(request),
      );
      return serializePlacement(placement);
    });
  }

  @Patch()
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Move a placed Asset to another Rack U' })
  @ApiOkResponse({ description: 'Asset placement moved.' })
  @ApiBadRequestResponse({ description: 'Placement request violates a rule.' })
  @ApiConflictResponse({ description: 'The Rack U was claimed concurrently.' })
  @ApiNotFoundResponse({
    description: 'Asset, Rack, or active placement was not found.',
  })
  move(
    @Req() request: AssetHttpRequest,
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
  ) {
    return this.execute(async () => {
      const params = parseAssetPlacementRequest(
        assetPlacementParamsSchema,
        rawParams,
        'Invalid Asset ID',
      );
      const body = parseAssetPlacementRequest(
        assetPlacementRequestSchema,
        rawBody,
        'Invalid Asset placement request',
      );
      const placement = await this.placements.move(
        params.asset_id,
        body.rack_id,
        body.u_position,
        requireAssetAdmin(request),
      );
      return serializePlacement(placement);
    });
  }

  @Delete()
  @RequirePermissions('asset:manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unmap an Asset while retaining placement history' })
  @ApiNoContentResponse({ description: 'Asset unmapped.' })
  @ApiNotFoundResponse({
    description: 'Asset or active placement was not found.',
  })
  async unmap(
    @Req() request: AssetHttpRequest,
    @Param() rawParams: unknown,
  ): Promise<void> {
    await this.execute(async () => {
      const params = parseAssetPlacementRequest(
        assetPlacementParamsSchema,
        rawParams,
        'Invalid Asset ID',
      );
      await this.placements.unmap(params.asset_id, requireAssetAdmin(request));
    });
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AssetReferenceNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof ActiveAssetPlacementNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof AssetPlacementConflictError)
        throw new ConflictException(error.message);
      if (error instanceof DomainError)
        throw new BadRequestException({ message: error.message });
      if (error instanceof ForbiddenException) throw error;
      throw error;
    }
  }
}

function serializePlacement(
  placement: import('../../domain/placement/asset-placement').AssetPlacement,
) {
  return {
    asset_id: placement.assetId,
    rack_id: placement.rackId,
    u_position: placement.uPosition.value,
  };
}

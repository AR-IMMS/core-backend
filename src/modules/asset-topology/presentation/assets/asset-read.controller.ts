import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermissions } from '@modules/iam';
import { createPaginatedResult } from '@platform/http/api/pagination/paginated-result';
import type { Asset } from '../../domain/asset/asset';
import {
  GetAssetUseCase,
  ListAssetsUseCase,
} from '../../application/assets/asset-query.use-case';
import {
  assetListQuerySchema,
  assetParamsSchema,
  parseAssetRequest,
} from './asset-registry.schemas';

@ApiTags('Asset Registry')
@ApiBearerAuth('HumanAccessToken')
@ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.' })
@Controller('asset-topology/assets')
export class AssetReadController {
  constructor(
    private readonly getAsset: GetAssetUseCase,
    private readonly listAssets: ListAssetsUseCase,
  ) {}

  @Get()
  @RequirePermissions('asset:read')
  @ApiOperation({ summary: 'List Assets by canonical ID' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque cursor from the previous page.',
  })
  @ApiQuery({
    name: 'page_size',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  })
  @ApiOkResponse({ description: 'Cursor-paginated Assets.' })
  @ApiBadRequestResponse({ description: 'The cursor or page size is invalid.' })
  async list(@Query() rawQuery: unknown) {
    const query = parseAssetRequest(
      assetListQuerySchema,
      rawQuery,
      'Invalid Asset list query',
    );
    const afterAssetId = query.cursor
      ? decodeAssetCursor(query.cursor)
      : undefined;
    const page = await this.listAssets.execute({
      pageSize: query.page_size,
      afterAssetId,
    });
    return createPaginatedResult(
      page.assets.map((asset) =>
        serializeAsset(asset, page.currentPlacements.get(asset.id) ?? null),
      ),
      {
        type: 'cursor',
        next_cursor: page.nextCursorAssetId
          ? encodeAssetCursor(page.nextCursorAssetId)
          : null,
      },
    );
  }

  @Get(':asset_id')
  @RequirePermissions('asset:read')
  @ApiOperation({ summary: 'Retrieve an Asset by canonical ID' })
  @ApiOkResponse({
    description: 'Canonical Asset reference and current placement.',
  })
  @ApiBadRequestResponse({ description: 'The Asset ID is invalid.' })
  @ApiNotFoundResponse({ description: 'Asset was not found.' })
  async get(@Param() rawParams: unknown) {
    const params = parseAssetRequest(
      assetParamsSchema,
      rawParams,
      'Invalid Asset ID',
    );
    const asset = await this.getAsset.execute(params.asset_id as never);
    if (!asset) throw new NotFoundException('Asset was not found');
    return {
      id: asset.id,
      name: asset.name,
      asset_type_id: asset.assetTypeId,
      lifecycle_state: asset.lifecycleState,
      current_placement: asset.currentPlacement
        ? {
            rack_id: asset.currentPlacement.rackId,
            u_position: asset.currentPlacement.uPosition,
          }
        : null,
    };
  }

  @Get(':asset_id/placement-history')
  @RequirePermissions('asset:read')
  @ApiOperation({ summary: 'List historical Asset placements' })
  @ApiOkResponse({ description: 'Time-bounded Asset Location history.' })
  @ApiNotFoundResponse({ description: 'Asset was not found.' })
  async placementHistory(@Param() rawParams: unknown) {
    const params = parseAssetRequest(
      assetParamsSchema,
      rawParams,
      'Invalid Asset ID',
    );
    const history = await this.getAsset.getAssetPlacementHistory(
      params.asset_id as never,
    );
    if (!history) throw new NotFoundException('Asset was not found');
    return history.map((item) => ({
      rack_id: item.rackId,
      u_position: item.uPosition,
      valid_from: item.validFrom,
      valid_to: item.validTo,
    }));
  }
}

function serializeAsset(
  asset: Asset,
  currentPlacement: {
    readonly rackId: string;
    readonly uPosition: number;
  } | null,
) {
  return {
    id: asset.id,
    name: asset.name,
    asset_type_id: asset.assetTypeId,
    model_id: asset.assetModelId ?? null,
    manufacturer_serial_number: asset.serialNumber ?? null,
    lifecycle_state: asset.lifecycleState,
    current_placement: currentPlacement
      ? {
          rack_id: currentPlacement.rackId,
          u_position: currentPlacement.uPosition,
        }
      : null,
  };
}

function encodeAssetCursor(assetId: string): string {
  return Buffer.from(JSON.stringify({ asset_id: assetId }), 'utf8').toString(
    'base64url',
  );
}

function decodeAssetCursor(cursor: string): string {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      !('asset_id' in parsed) ||
      typeof parsed.asset_id !== 'string' ||
      parsed.asset_id.trim().length === 0
    )
      throw new Error('invalid cursor');
    return parsed.asset_id;
  } catch {
    throw new BadRequestException('Asset cursor is invalid');
  }
}

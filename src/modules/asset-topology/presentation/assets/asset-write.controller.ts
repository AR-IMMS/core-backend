import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DomainError } from '../../domain/shared/domain-error';
import {
  AssetReferenceNotFoundError,
  RegisterAssetUseCase,
} from '../../application/assets/asset-registration.use-case';
import { UpdateAssetUseCase } from '../../application/assets/asset-update.use-case';
import { RetireAssetUseCase } from '../../application/assets/retire-asset.use-case';
import { AssetRetirementConflictError } from '../../application/assets/asset-retirement.errors';
import { GetAssetUseCase } from '../../application/assets/asset-query.use-case';
import { RequirePermissions } from '@modules/iam';
import {
  AssetParamsDto,
  RegisterAssetRequestDto,
  UpdateAssetRequestDto,
  assetParamsSchema,
  parseAssetRequest,
  registerAssetSchema,
  updateAssetSchema,
} from './asset-registry.schemas';
import { requireAssetAdmin, type AssetHttpRequest } from './asset-http-support';
import { QrMappingConflictError } from '../../application/qr/qr-mapping.errors';
import { assetTypeCodeFromId, assetTypeIdFromCode } from './asset-type-code';

@ApiTags('Asset Registry')
@ApiBearerAuth('HumanAccessToken')
@ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.' })
@Controller('asset-topology/assets')
export class AssetWriteController {
  constructor(
    private readonly registerAsset: RegisterAssetUseCase,
    private readonly updateAsset: UpdateAssetUseCase,
    private readonly getAsset: GetAssetUseCase,
    private readonly retireAsset: RetireAssetUseCase,
  ) {}

  @Post()
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Register a physical Asset' })
  @ApiCreatedResponse({ description: 'Asset registered.' })
  @ApiBadRequestResponse({ description: 'The Asset request is invalid.' })
  create(
    @Req() request: AssetHttpRequest,
    @Body() rawBody: RegisterAssetRequestDto,
  ) {
    return this.execute(async () => {
      const actor = requireAssetAdmin(request);
      const input = parseAssetRequest(
        registerAssetSchema,
        rawBody,
        'Invalid Asset registration request',
      );
      const asset = await this.registerAsset.execute(
        {
          name: input.name,
          assetTypeId: assetTypeIdFromCode(input.asset_type),
          modelId: input.model_id,
          serialNumber: input.manufacturer_serial_number,
        },
        actor,
      );
      return serializeAsset(asset, null);
    });
  }

  @Patch(':asset_id')
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Update Asset descriptive information' })
  @ApiOkResponse({ description: 'Asset updated.' })
  @ApiBadRequestResponse({ description: 'The Asset request is invalid.' })
  @ApiNotFoundResponse({ description: 'Asset was not found.' })
  update(
    @Req() request: AssetHttpRequest,
    @Param() rawParams: AssetParamsDto,
    @Body() rawBody: UpdateAssetRequestDto,
  ) {
    return this.execute(async () => {
      const actor = requireAssetAdmin(request);
      const params = parseAssetRequest(
        assetParamsSchema,
        rawParams,
        'Invalid Asset ID',
      );
      const input = parseAssetRequest(
        updateAssetSchema,
        rawBody,
        'Invalid Asset update request',
      );
      const asset = await this.updateAsset.execute(
        params.asset_id,
        {
          name: input.name,
          ...(Object.hasOwn(input, 'model_id')
            ? { modelId: input.model_id }
            : {}),
          ...(Object.hasOwn(input, 'manufacturer_serial_number')
            ? { serialNumber: input.manufacturer_serial_number }
            : {}),
        },
        actor,
      );
      const reference = await this.getAsset.execute(params.asset_id as never);
      return serializeAsset(asset, reference?.currentPlacement ?? null);
    });
  }

  @Post(':asset_id/retire')
  @HttpCode(204)
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Retire an unassigned, unbound Asset' })
  @ApiNoContentResponse({ description: 'Asset retired or already retired.' })
  @ApiNotFoundResponse({ description: 'Asset was not found.' })
  @ApiConflictResponse({
    description:
      'Asset is in maintenance, assigned to a Rack, or has an active Agent binding.',
  })
  async retire(
    @Req() request: AssetHttpRequest,
    @Param() rawParams: AssetParamsDto,
  ): Promise<void> {
    return this.execute(async () => {
      const actor = requireAssetAdmin(request);
      const params = parseAssetRequest(
        assetParamsSchema,
        rawParams,
        'Invalid Asset ID',
      );
      await this.retireAsset.execute(params.asset_id, actor);
    });
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AssetReferenceNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof AssetRetirementConflictError)
        throw new ConflictException(error.message);
      if (
        error instanceof DomainError &&
        error.code === 'ASSET_INVALID_RETIREMENT'
      ) {
        throw new ConflictException(error.message);
      }
      if (error instanceof DomainError)
        throw new BadRequestException({ message: error.message });
      if (error instanceof QrMappingConflictError)
        throw new ConflictException(error.message);
      if (error instanceof ForbiddenException) throw error;
      throw error;
    }
  }
}

function serializeAsset(
  asset: import('../../domain/asset/asset').Asset,
  currentPlacement: {
    readonly rackId: string;
    readonly uPosition: number;
  } | null,
) {
  return {
    id: asset.id,
    name: asset.name,
    asset_type: assetTypeCodeFromId(asset.assetTypeId),
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

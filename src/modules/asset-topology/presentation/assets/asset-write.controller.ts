import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
import type { AssetActor } from '../../application/assets/asset-registration.use-case';
import { UpdateAssetUseCase } from '../../application/assets/asset-update.use-case';
import { RequirePermissions, type RoleCode } from '@modules/iam';
import {
  assetParamsSchema,
  parseAssetRequest,
  registerAssetSchema,
  updateAssetSchema,
} from './asset-registry.schemas';

interface AssetHttpRequest {
  readonly user: { readonly userId: string; readonly role: RoleCode };
  readonly id?: string;
  readonly requestId?: string;
}

@ApiTags('Asset Registry')
@ApiBearerAuth('HumanAccessToken')
@ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.' })
@Controller('asset-topology/assets')
export class AssetWriteController {
  constructor(
    private readonly registerAsset: RegisterAssetUseCase,
    private readonly updateAsset: UpdateAssetUseCase,
  ) {}

  @Post()
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Register a physical Asset' })
  @ApiCreatedResponse({ description: 'Asset registered.' })
  @ApiBadRequestResponse({ description: 'The Asset request is invalid.' })
  create(@Req() request: AssetHttpRequest, @Body() rawBody: unknown) {
    return this.execute(async () => {
      const actor = requireAdmin(request);
      const input = parseAssetRequest(
        registerAssetSchema,
        rawBody,
        'Invalid Asset registration request',
      );
      const asset = await this.registerAsset.execute(
        {
          name: input.name,
          assetTypeId: input.asset_type_id,
          modelId: input.model_id,
          serialNumber: input.manufacturer_serial_number,
        },
        actor,
      );
      return serializeAsset(asset);
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
    @Param() rawParams: unknown,
    @Body() rawBody: unknown,
  ) {
    return this.execute(async () => {
      const actor = requireAdmin(request);
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
      return serializeAsset(asset);
    });
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AssetReferenceNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof DomainError)
        throw new BadRequestException({ message: error.message });
      if (error instanceof ForbiddenException) throw error;
      throw error;
    }
  }
}

function requireAdmin(request: AssetHttpRequest): AssetActor {
  if (request.user.role !== 'IT_ADMIN')
    throw new ForbiddenException('Only IT Admins can manage Assets.');
  return {
    type: 'user',
    id: request.user.userId,
    context: request.requestId ? { request_id: request.requestId } : undefined,
  };
}

function serializeAsset(asset: import('../../domain/asset/asset').Asset) {
  return {
    id: asset.id,
    name: asset.name,
    asset_type_id: asset.assetTypeId,
    model_id: asset.assetModelId ?? null,
    manufacturer_serial_number: asset.serialNumber ?? null,
    lifecycle_state: asset.lifecycleState,
    current_placement: null,
  };
}

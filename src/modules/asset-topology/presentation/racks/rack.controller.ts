import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermissions } from '@modules/iam';
import type { RoleCode } from '@modules/iam';
import { DomainError } from '../../domain/shared/domain-error';
import {
  RackResourceNotFoundError,
  RackManagementUseCases,
} from '../../application/racks/rack-management.use-case';
import type { TopologyActor } from '../../application/topology/topology-use-cases';
import { RackQueryUseCase } from '../../application/racks/rack-query.use-case';
import { TopologyResourceNotFoundError } from '../../application/topology/topology-use-cases';
import { parseTopologyRequest } from '../topology.schemas';
import {
  CreateRackRequestDto,
  MoveRackRequestDto,
  RackIdParamsDto,
  RackRoomParamsDto,
  UpdateRackRequestDto,
  createRackSchema,
  moveRackSchema,
  rackIdParamsSchema,
  rackRoomParamsSchema,
  updateRackSchema,
} from './rack.schemas';

interface RackRequest {
  readonly user: { readonly userId: string; readonly role: RoleCode };
}

/** HTTP endpoints for Rack management and confirmed Room-map reads. */
@ApiTags('Asset Topology - Racks')
@ApiBearerAuth('HumanAccessToken')
@ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.' })
@ApiForbiddenResponse({
  description: 'The caller lacks the required asset permission.',
})
@Controller('asset-topology')
export class RackController {
  constructor(
    private readonly racks: RackManagementUseCases,
    private readonly queries: RackQueryUseCase,
  ) {}

  @Get('rooms/:room_id/map')
  @RequirePermissions('asset:read')
  @ApiOperation({ summary: 'Retrieve a Room map and confirmed Rack cells' })
  @ApiOkResponse({ description: 'Room grid and active Rack cells.' })
  @ApiNotFoundResponse({ description: 'Room was not found.' })
  getRoomMap(@Param() paramsValue: RackRoomParamsDto) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        rackRoomParamsSchema,
        paramsValue,
        'Invalid Room ID',
      );
      const map = await this.queries.getRoomMap(params.room_id as never);
      if (!map) throw new RackResourceNotFoundError('Room');
      return {
        id: map.id,
        width_mm: map.widthMm,
        depth_mm: map.depthMm,
        grid_snap_mm: map.gridSnapMm,
        columns: map.columns,
        rows: map.rows,
        racks: map.racks.map(serializeRack),
      };
    });
  }

  @Post('rooms/:room_id/racks')
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Create a Rack with its initial Room-map cell' })
  @ApiCreatedResponse({
    description: 'Rack and initial location created atomically.',
  })
  @ApiBadRequestResponse({ description: 'Rack or cell request is invalid.' })
  @ApiNotFoundResponse({ description: 'Room was not found.' })
  create(
    @Req() request: RackRequest,
    @Param() paramsValue: RackRoomParamsDto,
    @Body() bodyValue: CreateRackRequestDto,
  ) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        rackRoomParamsSchema,
        paramsValue,
        'Invalid Room ID',
      );
      const body = parseTopologyRequest(
        createRackSchema,
        bodyValue,
        'Invalid Rack request',
      );
      const rack = await this.racks.create(
        {
          roomId: params.room_id,
          column: body.column,
          row: body.row,
          rotation: body.rotation,
          uCapacity: body.u_capacity,
          rowLabel: body.row_label ?? undefined,
          positionInRow: body.position_in_row ?? undefined,
        },
        actorFrom(request),
      );
      const reference = await this.queries.getRack(rack.id as never);
      return reference ? serializeRack(reference) : null;
    });
  }

  @Get('racks/:rack_id')
  @RequirePermissions('asset:read')
  @ApiOperation({ summary: 'Retrieve a Rack and its confirmed location' })
  @ApiOkResponse({
    description: 'Canonical Rack reference and current location.',
  })
  @ApiNotFoundResponse({ description: 'Rack was not found.' })
  get(@Param() paramsValue: RackIdParamsDto) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        rackIdParamsSchema,
        paramsValue,
        'Invalid Rack ID',
      );
      const rack = await this.queries.getRack(params.rack_id as never);
      if (!rack) throw new RackResourceNotFoundError('Rack');
      return serializeRack(rack);
    });
  }

  @Patch('racks/:rack_id')
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Update Rack capacity and row/position labels' })
  @ApiOkResponse({ description: 'Rack updated.' })
  update(
    @Req() request: RackRequest,
    @Param() paramsValue: RackIdParamsDto,
    @Body() bodyValue: UpdateRackRequestDto,
  ) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        rackIdParamsSchema,
        paramsValue,
        'Invalid Rack ID',
      );
      const body = parseTopologyRequest(
        updateRackSchema,
        bodyValue,
        'Invalid Rack update',
      );
      await this.racks.update(
        params.rack_id,
        {
          uCapacity: body.u_capacity,
          rowLabel: body.row_label,
          positionInRow: body.position_in_row,
        },
        actorFrom(request),
      );
      const reference = await this.queries.getRack(params.rack_id as never);
      return reference ? serializeRack(reference) : null;
    });
  }

  @Patch('racks/:rack_id/location')
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Move or rotate a Rack within the Room map' })
  @ApiOkResponse({
    description: 'Confirmed Rack location, or existing location for a no-op.',
  })
  @ApiBadRequestResponse({
    description: 'Destination cell is invalid or occupied.',
  })
  @ApiNotFoundResponse({ description: 'Rack or Room was not found.' })
  move(
    @Req() request: RackRequest,
    @Param() paramsValue: RackIdParamsDto,
    @Body() bodyValue: MoveRackRequestDto,
  ) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        rackIdParamsSchema,
        paramsValue,
        'Invalid Rack ID',
      );
      const body = parseTopologyRequest(
        moveRackSchema,
        bodyValue,
        'Invalid Rack location',
      );
      await this.racks.move(
        params.rack_id,
        {
          roomId: body.room_id,
          column: body.column,
          row: body.row,
          rotation: body.rotation,
        },
        actorFrom(request),
      );
      const reference = await this.queries.getRack(params.rack_id as never);
      return reference ? serializeRack(reference) : null;
    });
  }

  @Get('racks/:rack_id/locations')
  @RequirePermissions('asset:read')
  @ApiOperation({ summary: 'Retrieve Rack Room-map location history' })
  @ApiOkResponse({ description: 'Time-bounded Rack location history.' })
  @ApiNotFoundResponse({ description: 'Rack was not found.' })
  getLocationHistory(@Param() paramsValue: RackIdParamsDto) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        rackIdParamsSchema,
        paramsValue,
        'Invalid Rack ID',
      );
      const locations = await this.queries.getRackLocationHistory(
        params.rack_id as never,
      );
      if (!locations) throw new RackResourceNotFoundError('Rack');
      return {
        rack_id: params.rack_id,
        locations: locations.map((location) => ({
          room_id: location.roomId,
          column: location.column,
          row: location.row,
          rotation: location.rotation,
          valid_from: location.validFrom,
          valid_to: location.validTo,
        })),
      };
    });
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof RackResourceNotFoundError ||
        error instanceof TopologyResourceNotFoundError
      )
        throw new NotFoundException(error.message);
      if (error instanceof DomainError)
        throw new BadRequestException({ message: error.message });
      if (error instanceof ForbiddenException) throw error;
      throw error;
    }
  }
}

function actorFrom(request: RackRequest): TopologyActor {
  if (request.user.role !== 'IT_ADMIN')
    throw new ForbiddenException('Only IT Admins can manage Racks.');
  return { type: 'user', id: request.user.userId };
}

function serializeRack(
  rack: NonNullable<Awaited<ReturnType<RackQueryUseCase['getRack']>>>,
) {
  return {
    id: rack.id,
    u_capacity: rack.uCapacity,
    row_label: rack.rowLabel ?? null,
    position_in_row: rack.positionInRow ?? null,
    current_location: rack.currentLocation
      ? {
          room_id: rack.currentLocation.roomId,
          column: rack.currentLocation.column,
          row: rack.currentLocation.row,
          rotation: rack.currentLocation.rotation,
        }
      : null,
  };
}

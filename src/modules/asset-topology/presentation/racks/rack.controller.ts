import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiHeader,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { RequirePermissions } from '@modules/iam';
import type { RoleCode } from '@modules/iam';
import { DomainError } from '../../domain/shared/domain-error';
import {
  RackResourceNotFoundError,
  RackManagementUseCases,
} from '../../application/racks/rack-management.use-case';
import {
  RoomLayoutRevisionConflictError,
  type TopologyActor,
} from '../../application/topology/topology-use-cases';
import { RackQueryUseCase } from '../../application/racks/rack-query.use-case';
import { TopologyResourceNotFoundError } from '../../application/topology/topology-use-cases';
import { parseTopologyRequest } from '../topology.schemas';
import { layoutEtag, requireLayoutRevision } from '../layout-etag';
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
  readonly headers?: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
}

interface RackHttpResponse {
  setHeader(name: string, value: string): void;
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
  getRoomMap(
    @Param() paramsValue: RackRoomParamsDto,
    @Res({ passthrough: true }) response?: RackHttpResponse,
  ) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        rackRoomParamsSchema,
        paramsValue,
        'Invalid Room ID',
      );
      const map = await this.queries.getRoomMap(params.room_id as never);
      if (!map) throw new RackResourceNotFoundError('Room');
      response?.setHeader('ETag', layoutEtag(map.layoutRevision));
      return {
        id: map.id,
        status: map.status,
        width_mm: map.widthMm,
        depth_mm: map.depthMm,
        grid_snap_mm: map.gridSnapMm,
        grid: { columns: map.columns, rows: map.rows, origin: 'lower-left' },
        layout_revision: map.layoutRevision,
        walkway_cells: map.walkwayCells,
        capacity: {
          total_cells: map.capacity.totalCells,
          rack_capacity_cells: map.capacity.rackCapacityCells,
          active_rack_count: map.capacity.activeRackCount,
          free_rack_cells: map.capacity.freeRackCells,
        },
        racks: map.racks
          .filter((rack) => rack.currentLocation !== null)
          .map((rack) => ({
            rack_id: rack.id,
            name: rack.name,
            column: rack.currentLocation!.column,
            row: rack.currentLocation!.row,
            rotation: rack.currentLocation!.rotation,
            u_capacity: rack.uCapacity,
            location_label: formatLocationLabel(
              rack.currentLocation!.row,
              rack.currentLocation!.column,
            ),
          })),
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
  @ApiConflictResponse({
    description: 'Room is retired.',
  })
  @ApiResponse({
    status: HttpStatus.PRECONDITION_FAILED,
    description: 'If-Match is stale.',
  })
  @ApiResponse({ status: 428, description: 'If-Match is required.' })
  @ApiUnprocessableEntityResponse({
    description: 'Rack cell is invalid or reserved.',
  })
  @ApiNotFoundResponse({ description: 'Room was not found.' })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Strong ETag returned by the Room map read.',
  })
  create(
    @Req() request: RackRequest,
    @Param() paramsValue: RackRoomParamsDto,
    @Body() bodyValue: CreateRackRequestDto,
    @Res({ passthrough: true }) response?: RackHttpResponse,
  ) {
    return this.execute(async () => {
      const actor = actorFrom(request);
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
          name: body.name,
          uCapacity: body.u_capacity,
          expectedLayoutRevision: requireLayoutRevision(
            request.headers?.['if-match'],
          ),
        },
        actor,
      );
      const reference = await this.queries.getRack(rack.value.id as never);
      const revision = rack.layoutRevisions.find(
        ({ roomId }) => roomId === params.room_id,
      )?.revision;
      if (revision !== undefined)
        response?.setHeader('ETag', layoutEtag(revision));
      return reference
        ? {
            ...serializeRack(reference),
            layout_revisions: rack.layoutRevisions.map(
              ({ roomId, revision }) => ({ room_id: roomId, revision }),
            ),
          }
        : null;
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
  @ApiOperation({ summary: 'Update Rack name or capacity' })
  @ApiOkResponse({ description: 'Rack updated.' })
  update(
    @Req() request: RackRequest,
    @Param() paramsValue: RackIdParamsDto,
    @Body() bodyValue: UpdateRackRequestDto,
  ) {
    return this.execute(async () => {
      const actor = actorFrom(request);
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
          name: body.name,
          uCapacity: body.u_capacity,
        },
        actor,
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
  @ApiConflictResponse({
    description: 'Destination Room is retired.',
  })
  @ApiResponse({
    status: HttpStatus.PRECONDITION_FAILED,
    description: 'If-Match or If-Match-Source is stale.',
  })
  @ApiResponse({
    status: 428,
    description: 'If-Match or the cross-Room If-Match-Source is required.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Destination cell is invalid or reserved.',
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description:
      'Strong ETag for the destination Room returned by its map read.',
  })
  @ApiHeader({
    name: 'If-Match-Source',
    required: false,
    description:
      'Required for a cross-Room move; strong ETag returned by the source Room map read.',
  })
  @ApiNotFoundResponse({ description: 'Rack or Room was not found.' })
  move(
    @Req() request: RackRequest,
    @Param() paramsValue: RackIdParamsDto,
    @Body() bodyValue: MoveRackRequestDto,
    @Res({ passthrough: true }) response?: RackHttpResponse,
  ) {
    return this.execute(async () => {
      const actor = actorFrom(request);
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
      const moved = await this.racks.move(
        params.rack_id,
        {
          roomId: body.room_id,
          column: body.column,
          row: body.row,
          rotation: body.rotation,
          expectedLayoutRevision: requireLayoutRevision(
            request.headers?.['if-match'],
          ),
          ...(request.headers?.['if-match-source'] === undefined
            ? {}
            : {
                expectedSourceLayoutRevision: requireLayoutRevision(
                  request.headers['if-match-source'],
                  'If-Match-Source',
                ),
              }),
        },
        actor,
      );
      const reference = await this.queries.getRack(params.rack_id as never);
      const destinationRevision = moved.layoutRevisions.find(
        ({ roomId }) => roomId === body.room_id,
      )?.revision;
      if (destinationRevision !== undefined) {
        response?.setHeader('ETag', layoutEtag(destinationRevision));
      }
      const sourceRevision = moved.layoutRevisions.find(
        ({ roomId }) => roomId !== body.room_id,
      )?.revision;
      if (sourceRevision !== undefined) {
        response?.setHeader('ETag-Source', layoutEtag(sourceRevision));
      }
      return reference
        ? {
            ...serializeRack(reference),
            layout_revisions: moved.layoutRevisions.map(
              ({ roomId, revision }) => ({ room_id: roomId, revision }),
            ),
          }
        : null;
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
      if (error instanceof RoomLayoutRevisionConflictError) {
        throw new HttpException(
          { code: 'ROOM_LAYOUT_REVISION_CONFLICT', message: error.message },
          HttpStatus.PRECONDITION_FAILED,
        );
      }
      if (error instanceof DomainError) {
        if (error.code === 'ROOM_LAYOUT_REVISION_REQUIRED') {
          throw new HttpException(
            { code: 'LAYOUT_PRECONDITION_REQUIRED', message: error.message },
            428,
          );
        }
        if (error.code === 'ROOM_RETIRED') {
          throw new ConflictException({
            code: error.code,
            message: error.message,
          });
        }
        if (error.code === 'RACK_OVERLAP') {
          throw new ConflictException({
            code: 'RACK_CELL_OCCUPIED',
            message: error.message,
          });
        }
        if (error.code === 'RACK_CELL_RESERVED_AS_WALKWAY') {
          throw new ConflictException({
            code: error.code,
            message: error.message,
          });
        }
        if (error.code === 'RACK_OUTSIDE_ROOM') {
          throw new UnprocessableEntityException({
            code: 'CELL_OUT_OF_BOUNDS',
            message: error.message,
          });
        }
        if (
          error.code === 'CELL_OUT_OF_BOUNDS' ||
          error.code === 'DUPLICATE_WALKWAY_CELL'
        ) {
          throw new UnprocessableEntityException({
            code: error.code,
            message: error.message,
          });
        }
        throw new BadRequestException({ message: error.message });
      }
      if (error instanceof ForbiddenException) throw error;
      throw error;
    }
  }
}

function rowLetters(row: number): string {
  let value = row + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function formatLocationLabel(row: number, column: number): string {
  return `${rowLetters(row)}-${column + 1}`;
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
    name: rack.name,
    u_capacity: rack.uCapacity,
    location_label: rack.currentLocation
      ? formatLocationLabel(
          rack.currentLocation.row,
          rack.currentLocation.column,
        )
      : null,
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

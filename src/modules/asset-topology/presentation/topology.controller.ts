import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpCode,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiHeader,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { DomainError } from '../domain/shared/domain-error';
import type { Room } from '../domain/topology/room';
import type { Site } from '../domain/topology/site';
import {
  RoomLayoutRevisionConflictError,
  RoomHasActiveRacksError,
  TopologyResourceNotFoundError,
  TopologyUseCases,
} from '../application/topology/topology-use-cases';
import type { TopologyActor } from '../application/topology/topology-use-cases';
import { layoutEtag, requireLayoutRevision } from './layout-etag';
import { RequirePermissions } from '@modules/iam';
import type { RoleCode } from '@modules/iam';
import {
  CreateRoomRequestDto,
  CreateSiteRequestDto,
  DataCenterParamsDto,
  RoomParamsDto,
  SiteParamsDto,
  UpdateRoomRequestDto,
  UpdateSiteRequestDto,
  createRoomSchema,
  createSiteSchema,
  dataCenterParamsSchema,
  parseTopologyRequest,
  roomParamsSchema,
  siteParamsSchema,
  updateRoomSchema,
  updateSiteSchema,
} from './topology.schemas';

interface TopologyHttpRequest {
  readonly user: { readonly userId: string; readonly role: RoleCode };
  readonly headers?: Readonly<
    Record<string, string | readonly string[] | undefined>
  >;
}

interface TopologyHttpResponse {
  setHeader(name: string, value: string): void;
}

/** Dashboard REST endpoints for the seeded Data Center, Sites, and Rooms. */
@ApiTags('Asset Topology')
@ApiBearerAuth('HumanAccessToken')
@ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.' })
@ApiForbiddenResponse({
  description: 'The caller lacks the required asset permission.',
})
@Controller('asset-topology')
export class TopologyController {
  constructor(private readonly topology: TopologyUseCases) {}

  @Get('data-centers/default')
  @RequirePermissions('asset:read')
  @ApiOperation({ summary: 'Retrieve the seeded default Data Center' })
  @ApiOkResponse({ description: 'Default Data Center.' })
  getDefaultDataCenter() {
    return this.execute(async () => {
      const dataCenter = await this.topology.getDefaultDataCenter();
      return { id: dataCenter.id, name: dataCenter.name };
    });
  }

  @Get('data-centers/:data_center_id/sites')
  @RequirePermissions('asset:read')
  @ApiOperation({ summary: 'List Sites beneath a Data Center' })
  @ApiParam({ name: 'data_center_id', required: true, type: String })
  @ApiOkResponse({ description: 'Sites beneath the requested Data Center.' })
  @ApiNotFoundResponse({ description: 'Data Center was not found.' })
  listSites(@Param() rawParams: DataCenterParamsDto) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        dataCenterParamsSchema,
        rawParams,
        'Invalid Data Center ID',
      );
      const sites = await this.topology.listSites(
        params.data_center_id as never,
      );
      return sites.map(serializeSite);
    });
  }

  @Post('data-centers/:data_center_id/sites')
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Create a Site beneath a Data Center' })
  @ApiParam({ name: 'data_center_id', required: true, type: String })
  @ApiCreatedResponse({ description: 'Site created.' })
  @ApiBadRequestResponse({ description: 'The Site request is invalid.' })
  @ApiNotFoundResponse({ description: 'Data Center was not found.' })
  createSite(
    @Req() request: TopologyHttpRequest,
    @Param() rawParams: DataCenterParamsDto,
    @Body() rawBody: CreateSiteRequestDto,
  ) {
    return this.execute(async () => {
      const actor = actorFrom(request);
      const params = parseTopologyRequest(
        dataCenterParamsSchema,
        rawParams,
        'Invalid Data Center ID',
      );
      const body = parseTopologyRequest(
        createSiteSchema,
        rawBody,
        'Invalid Site request',
      );
      const site = await this.topology.createSite(
        { name: body.name, dataCenterId: params.data_center_id as never },
        actor,
      );
      return serializeSite(site);
    });
  }

  @Get('sites/:site_id')
  @RequirePermissions('asset:read')
  @ApiOperation({ summary: 'Retrieve a Site' })
  @ApiParam({ name: 'site_id', required: true, type: String })
  @ApiOkResponse({ description: 'Site details.' })
  @ApiNotFoundResponse({ description: 'Site was not found.' })
  getSite(@Param() rawParams: SiteParamsDto) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        siteParamsSchema,
        rawParams,
        'Invalid Site ID',
      );
      return serializeSite(
        await this.topology.getSite(params.site_id as never),
      );
    });
  }

  @Patch('sites/:site_id')
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Update a Site name' })
  @ApiParam({ name: 'site_id', required: true, type: String })
  @ApiOkResponse({ description: 'Site updated.' })
  @ApiBadRequestResponse({ description: 'The Site request is invalid.' })
  @ApiNotFoundResponse({ description: 'Site was not found.' })
  updateSite(
    @Req() request: TopologyHttpRequest,
    @Param() rawParams: SiteParamsDto,
    @Body() rawBody: UpdateSiteRequestDto,
  ) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        siteParamsSchema,
        rawParams,
        'Invalid Site ID',
      );
      const body = parseTopologyRequest(
        updateSiteSchema,
        rawBody,
        'Invalid Site update request',
      );
      return serializeSite(
        await this.topology.updateSite(
          params.site_id as never,
          { name: body.name },
          actorFrom(request),
        ),
      );
    });
  }

  @Get('sites/:site_id/rooms')
  @RequirePermissions('asset:read')
  @ApiOperation({ summary: 'List Rooms beneath a Site' })
  @ApiParam({ name: 'site_id', required: true, type: String })
  @ApiOkResponse({ description: 'Rooms beneath the requested Site.' })
  @ApiNotFoundResponse({ description: 'Site was not found.' })
  listRooms(@Param() rawParams: SiteParamsDto) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        siteParamsSchema,
        rawParams,
        'Invalid Site ID',
      );
      const rooms = await this.topology.listRooms(params.site_id as never);
      return rooms.map(serializeRoom);
    });
  }

  @Post('sites/:site_id/rooms')
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Create a Room beneath a Site' })
  @ApiParam({ name: 'site_id', required: true, type: String })
  @ApiCreatedResponse({ description: 'Room created.' })
  @ApiBadRequestResponse({ description: 'The Room request is invalid.' })
  @ApiNotFoundResponse({ description: 'Site was not found.' })
  createRoom(
    @Req() request: TopologyHttpRequest,
    @Param() rawParams: SiteParamsDto,
    @Body() rawBody: CreateRoomRequestDto,
  ) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        siteParamsSchema,
        rawParams,
        'Invalid Site ID',
      );
      const body = parseTopologyRequest(
        createRoomSchema,
        rawBody,
        'Invalid Room request',
      );
      const room = await this.topology.createRoom(
        {
          name: body.name,
          siteId: params.site_id as never,
          widthMm: body.width_mm,
          depthMm: body.depth_mm,
          gridSnapMm: body.grid_snap_mm,
        },
        actorFrom(request),
      );
      return serializeRoom(room);
    });
  }

  @Get('rooms/:room_id')
  @RequirePermissions('asset:read')
  @ApiOperation({ summary: 'Retrieve a Room and its map configuration' })
  @ApiParam({ name: 'room_id', required: true, type: String })
  @ApiOkResponse({
    description:
      'Room details and Room map, including retired status for history.',
  })
  @ApiNotFoundResponse({ description: 'Room was not found.' })
  getRoom(
    @Param() rawParams: RoomParamsDto,
    @Res({ passthrough: true }) response?: TopologyHttpResponse,
  ) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        roomParamsSchema,
        rawParams,
        'Invalid Room ID',
      );
      const room = await this.topology.getRoom(params.room_id as never);
      response?.setHeader('ETag', layoutEtag(room.layoutRevision));
      return serializeRoom(room);
    });
  }

  @Delete('rooms/:room_id')
  @RequirePermissions('asset:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retire an empty Room' })
  @ApiParam({ name: 'room_id', required: true, type: String })
  @ApiNoContentResponse({
    description: 'Room retired; its record is retained for history.',
  })
  @ApiNotFoundResponse({ description: 'Room was not found.' })
  @ApiConflictResponse({
    description: 'Room has a placed Rack or its layout changed concurrently.',
  })
  retireRoom(
    @Req() request: TopologyHttpRequest,
    @Param() rawParams: RoomParamsDto,
  ) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        roomParamsSchema,
        rawParams,
        'Invalid Room ID',
      );
      await this.topology.retireRoom(
        params.room_id as never,
        actorFrom(request),
      );
    });
  }

  @Patch('rooms/:room_id')
  @RequirePermissions('asset:manage')
  @ApiOperation({ summary: 'Update a Room name and map configuration' })
  @ApiParam({ name: 'room_id', required: true, type: String })
  @ApiOkResponse({ description: 'Room updated.' })
  @ApiBadRequestResponse({ description: 'The Room request is invalid.' })
  @ApiNotFoundResponse({ description: 'Room was not found.' })
  @ApiConflictResponse({
    description: 'Room is retired.',
  })
  @ApiResponse({
    status: HttpStatus.PRECONDITION_FAILED,
    description: 'If-Match is stale.',
  })
  @ApiResponse({
    status: 428,
    description: 'If-Match is required for a layout change.',
  })
  @ApiHeader({
    name: 'If-Match',
    required: false,
    description:
      'Required for layout changes. Strong ETag returned by a Room read.',
  })
  @ApiUnprocessableEntityResponse({ description: 'Room layout is invalid.' })
  updateRoom(
    @Req() request: TopologyHttpRequest,
    @Param() rawParams: RoomParamsDto,
    @Body() rawBody: UpdateRoomRequestDto,
    @Res({ passthrough: true }) response?: TopologyHttpResponse,
  ) {
    return this.execute(async () => {
      const actor = actorFrom(request);
      const params = parseTopologyRequest(
        roomParamsSchema,
        rawParams,
        'Invalid Room ID',
      );
      const body = parseTopologyRequest(
        updateRoomSchema,
        rawBody,
        'Invalid Room update request',
      );
      const layoutChange =
        body.width_mm !== undefined ||
        body.depth_mm !== undefined ||
        body.grid_snap_mm !== undefined ||
        body.walkway_cells !== undefined;
      const room = await this.topology.updateRoom(
        params.room_id as never,
        {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.width_mm === undefined ? {} : { widthMm: body.width_mm }),
          ...(body.depth_mm === undefined ? {} : { depthMm: body.depth_mm }),
          ...(body.grid_snap_mm === undefined
            ? {}
            : { gridSnapMm: body.grid_snap_mm }),
          ...(body.walkway_cells === undefined
            ? {}
            : { walkwayCells: body.walkway_cells }),
          ...(layoutChange
            ? {
                expectedLayoutRevision: requireLayoutRevision(
                  request.headers?.['if-match'],
                ),
              }
            : {}),
        },
        actor,
      );
      response?.setHeader('ETag', layoutEtag(room.layoutRevision));
      return serializeRoom(room);
    });
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof TopologyResourceNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof RoomLayoutRevisionConflictError) {
        throw new HttpException(
          { code: 'ROOM_LAYOUT_REVISION_CONFLICT', message: error.message },
          HttpStatus.PRECONDITION_FAILED,
        );
      }
      if (error instanceof RoomHasActiveRacksError) {
        throw new ConflictException({
          code: 'ROOM_HAS_ACTIVE_RACKS',
          message: error.message,
        });
      }
      if (error instanceof DomainError) {
        if (error.code === 'ROOM_RETIRED') {
          throw new ConflictException({
            code: error.code,
            message: error.message,
          });
        }
        if (error.code === 'ROOM_LAYOUT_REVISION_REQUIRED') {
          throw new HttpException(
            { code: 'LAYOUT_PRECONDITION_REQUIRED', message: error.message },
            428,
          );
        }
        if (ROOM_LAYOUT_VALIDATION_CODES.has(error.code)) {
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

const ROOM_LAYOUT_VALIDATION_CODES = new Set([
  'CELL_OUT_OF_BOUNDS',
  'DUPLICATE_WALKWAY_CELL',
  'WALKWAY_CELL_OCCUPIED_BY_RACK',
  'ROOM_GRID_CHANGE_INVALIDATES_LAYOUT',
  'GRID_SNAP_CHANGE_NOT_ALLOWED',
]);

function actorFrom(request: TopologyHttpRequest): TopologyActor {
  if (request.user.role !== 'IT_ADMIN') {
    throw new ForbiddenException('Only IT Admins can manage topology.');
  }
  return { type: 'user', id: request.user.userId };
}

function serializeSite(site: Site) {
  return { id: site.id, name: site.name, data_center_id: site.dataCenterId };
}

function serializeRoom(room: Room) {
  return {
    id: room.id,
    name: room.name,
    site_id: room.siteId,
    width_mm: room.roomMap.widthMm,
    depth_mm: room.roomMap.depthMm,
    grid_snap_mm: room.roomMap.gridSnapMm,
    layout_revision: room.layoutRevision,
    status: room.status,
    walkway_cells: room.roomMap.walkwayCells,
  };
}

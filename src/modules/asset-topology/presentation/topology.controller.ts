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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { DomainError } from '../domain/shared/domain-error';
import type { Room } from '../domain/topology/room';
import type { Site } from '../domain/topology/site';
import {
  TopologyResourceNotFoundError,
  TopologyUseCases,
} from '../application/topology/topology-use-cases';
import type { TopologyActor } from '../application/topology/topology-use-cases';
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
        actorFrom(request),
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
  @ApiOkResponse({ description: 'Room details and Room map.' })
  @ApiNotFoundResponse({ description: 'Room was not found.' })
  getRoom(@Param() rawParams: RoomParamsDto) {
    return this.execute(async () => {
      const params = parseTopologyRequest(
        roomParamsSchema,
        rawParams,
        'Invalid Room ID',
      );
      return serializeRoom(
        await this.topology.getRoom(params.room_id as never),
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
  updateRoom(
    @Req() request: TopologyHttpRequest,
    @Param() rawParams: RoomParamsDto,
    @Body() rawBody: UpdateRoomRequestDto,
  ) {
    return this.execute(async () => {
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
      return serializeRoom(
        await this.topology.updateRoom(
          params.room_id as never,
          {
            name: body.name,
            widthMm: body.width_mm,
            depthMm: body.depth_mm,
            gridSnapMm: body.grid_snap_mm,
          },
          actorFrom(request),
        ),
      );
    });
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof TopologyResourceNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof DomainError) {
        throw new BadRequestException({ message: error.message });
      }
      if (error instanceof ForbiddenException) throw error;
      throw error;
    }
  }
}

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
  };
}

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
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermissions } from '@modules/iam/presentation/authorization.decorators';
import { createPaginatedResult } from '@platform/http/api/pagination/paginated-result';
import { GetAgentInstallationUseCase } from '../../application/agent-registry/use-cases/get-agent-installation.use-case';
import type {
  AgentRegistryActiveBindingView,
  AgentRegistryBindingHistoryView,
} from '../../application/agent-registry/ports/agent-registry-query.port';
import { ListAgentInstallationsUseCase } from '../../application/agent-registry/use-cases/list-agent-installations.use-case';
import { ListInstallationBindingsUseCase } from '../../application/agent-registry/use-cases/list-installation-bindings.use-case';
import {
  decodeBindingsCursor,
  decodeInstallationCursor,
  encodeBindingsCursor,
  encodeInstallationCursor,
  InvalidAgentRegistryCursorError,
} from './agent-registry.cursor';
import {
  AgentInstallationParamsDto,
  AgentRegistryBindingsQueryDto,
  AgentRegistryListQueryDto,
  agentInstallationParamsSchema,
  agentRegistryBindingsQuerySchema,
  agentRegistryListQuerySchema,
  parseAgentRegistryRequest,
} from './agent-registry.schemas';

@ApiTags('Agent Registry')
@ApiBearerAuth('HumanAccessToken')
@ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.' })
@ApiForbiddenResponse({ description: 'The caller lacks agent:manage.' })
@ApiInternalServerErrorResponse({
  description: 'An unexpected server error occurred.',
})
@Controller('agents')
export class AgentRegistryController {
  constructor(
    private readonly listInstallations: ListAgentInstallationsUseCase,
    private readonly getInstallation: GetAgentInstallationUseCase,
    private readonly listBindings: ListInstallationBindingsUseCase,
  ) {}

  @Get()
  @RequirePermissions('agent:manage')
  @ApiOperation({ summary: 'List Agent installations' })
  @ApiQuery({
    name: 'page_size',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    schema: { type: 'string', maxLength: 512 },
  })
  @ApiQuery({
    name: 'node_id',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ description: 'Cursor-paginated Agent installations.' })
  @ApiBadRequestResponse({
    description: 'The list filters or cursor are invalid.',
  })
  async list(@Query() rawQuery: AgentRegistryListQueryDto) {
    const query = parseAgentRegistryRequest(
      agentRegistryListQuerySchema,
      rawQuery,
      'Invalid Agent list query',
    );
    const afterInstallationId = query.cursor
      ? decodeCursor(() => decodeInstallationCursor(query.cursor!))
      : undefined;
    const page = await this.listInstallations.execute({
      pageSize: query.page_size,
      afterInstallationId,
      nodeId: query.node_id,
    });
    return createPaginatedResult(page.items.map(serializeInstallation), {
      type: 'cursor',
      next_cursor: page.nextCursorInstallationId
        ? encodeInstallationCursor(page.nextCursorInstallationId)
        : null,
    });
  }

  @Get(':installationId/bindings')
  @RequirePermissions('agent:manage')
  @ApiOperation({ summary: 'List an installation binding history' })
  @ApiOkResponse({ description: 'Cursor-paginated Agent binding history.' })
  @ApiBadRequestResponse({
    description: 'The installation ID or cursor is invalid.',
  })
  @ApiNotFoundResponse({ description: 'Installation was not found.' })
  async bindings(
    @Param() rawParams: AgentInstallationParamsDto,
    @Query() rawQuery: AgentRegistryBindingsQueryDto,
  ) {
    const params = parseAgentRegistryRequest(
      agentInstallationParamsSchema,
      rawParams,
      'Invalid installation ID',
    );
    const query = parseAgentRegistryRequest(
      agentRegistryBindingsQuerySchema,
      rawQuery,
      'Invalid Agent binding history query',
    );
    const after = query.cursor
      ? decodeCursor(() => decodeBindingsCursor(query.cursor!))
      : undefined;
    const page = await this.listBindings.execute({
      installationId: params.installationId,
      pageSize: query.page_size,
      after,
    });
    if (!page) throw new NotFoundException({ code: 'NOT_FOUND' });
    return createPaginatedResult(page.items.map(serializeBinding), {
      type: 'cursor',
      next_cursor: page.nextCursor
        ? encodeBindingsCursor(page.nextCursor)
        : null,
    });
  }

  @Get(':installationId')
  @RequirePermissions('agent:manage')
  @ApiOperation({ summary: 'Get an Agent installation' })
  @ApiOkResponse({ description: 'Installation details and current binding.' })
  @ApiBadRequestResponse({ description: 'The installation ID is invalid.' })
  @ApiNotFoundResponse({ description: 'Installation was not found.' })
  async get(@Param() rawParams: AgentInstallationParamsDto) {
    const params = parseAgentRegistryRequest(
      agentInstallationParamsSchema,
      rawParams,
      'Invalid installation ID',
    );
    const installation = await this.getInstallation.execute(
      params.installationId,
    );
    if (!installation) throw new NotFoundException({ code: 'NOT_FOUND' });
    return serializeInstallation(installation);
  }
}

function serializeInstallation(installation: {
  readonly installationId: string;
  readonly agentVersion: string;
  readonly environment: {
    readonly os: string;
    readonly architecture: string;
    readonly hostname?: string;
  };
  readonly createdAt: Date;
  readonly updatedAt: Date | null;
  readonly currentBinding: {
    readonly bindingId: string;
    readonly nodeId: string;
    readonly status: 'active';
    readonly createdAt: Date;
  } | null;
}) {
  return {
    installation_id: installation.installationId,
    agent_version: installation.agentVersion,
    environment: {
      os: installation.environment.os,
      architecture: installation.environment.architecture,
      ...(installation.environment.hostname
        ? { hostname: installation.environment.hostname }
        : {}),
    },
    created_at: installation.createdAt.toISOString(),
    updated_at: installation.updatedAt?.toISOString() ?? null,
    current_binding: installation.currentBinding
      ? serializeBinding(installation.currentBinding)
      : null,
  };
}

function serializeBinding(
  binding: AgentRegistryActiveBindingView | AgentRegistryBindingHistoryView,
) {
  return {
    binding_id: binding.bindingId,
    node_id: binding.nodeId,
    status: binding.status,
    created_at: binding.createdAt.toISOString(),
    ...(binding.status === 'revoked'
      ? { revoked_at: binding.revokedAt.toISOString() }
      : {}),
  };
}

function decodeCursor<T>(decode: () => T): T {
  try {
    return decode();
  } catch (error) {
    if (error instanceof InvalidAgentRegistryCursorError) {
      throw new BadRequestException({
        message: 'Agent Registry cursor is invalid',
      });
    }
    throw error;
  }
}

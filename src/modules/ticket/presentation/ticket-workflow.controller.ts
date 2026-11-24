import {
  applyDecorators,
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtension,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  CurrentHumanPrincipal,
  RequirePermissions,
  type PermissionCode,
} from '@modules/iam';
import { createPaginatedResult } from '@platform/http/api/pagination/paginated-result';
import { TicketWorkflow } from '../application/ticket-workflow';
import {
  TicketParamsDto,
  TicketActorDto,
  ticketDetail,
  ticketRequest,
  detailResponse,
  ticketProblem,
} from './ticket.controller';
import {
  CloseTicketDto,
  CreateTicketDto,
  ReopenTicketDto,
  ResponsibilitiesDto,
  ReviewedDraftDto,
  TicketArticleDto,
  TicketArticleQueryDto,
  TicketInformationDto,
  TicketLinksDto,
  TicketListQueryDto,
  TicketTransitionDto,
  articleSchema,
  closeSchema,
  createTicketSchema,
  draftSchema,
  informationSchema,
  linksSchema,
  reopenSchema,
  responsibilitySchema,
  transitionSchema,
} from './ticket-workflow.schemas';

const pathId = () =>
  ApiParam({
    name: 'ticket_id',
    schema: { type: 'string', pattern: '^[1-9][0-9]{0,15}$' },
  });
const operationKey = 'Idempotency-Key';
const integer = { type: 'integer', minimum: 1 } as const;
const responseText = { type: 'string' } as const;
const linksResponse: SchemaObject = {
  type: 'object',
  required: ['incident_id', 'asset_ids', 'maintenance_activity_ids'],
  properties: {
    incident_id: { ...responseText, nullable: true },
    asset_ids: { type: 'array', items: responseText },
    maintenance_activity_ids: { type: 'array', items: responseText },
  },
};
const articleResponse: SchemaObject = {
  type: 'object',
  required: ['article_id', 'type', 'internal', 'body_text', 'created_at'],
  properties: {
    article_id: integer,
    type: responseText,
    internal: { type: 'boolean' },
    body_text: { ...responseText, nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};
const articleReceipt: SchemaObject = {
  type: 'object',
  required: ['ticket_id', 'article_id'],
  properties: { ticket_id: integer, article_id: integer },
};

function responseSchema(data: SchemaObject, paginated: boolean): SchemaObject {
  return {
    type: 'object',
    required: ['data', 'meta', ...(paginated ? ['pagination'] : [])],
    properties: {
      data: paginated ? { type: 'array', items: data } : data,
      meta: {
        type: 'object',
        required: ['request_id'],
        properties: { request_id: responseText, trace_id: responseText },
      },
      ...(paginated
        ? {
            pagination: {
              type: 'object',
              required: ['type', 'next_cursor'],
              properties: {
                type: { type: 'string', enum: ['cursor'] },
                next_cursor: { ...responseText, nullable: true },
              },
            },
          }
        : {}),
    },
  };
}

export function ticketOperation(options: {
  summary: string;
  description?: string;
  permission: PermissionCode;
  data: SchemaObject;
  body?: z.ZodType;
  resource?: boolean;
  created?: boolean;
  paginated?: boolean;
}) {
  return applyDecorators(
    RequirePermissions(options.permission),
    ApiExtension('x-required-permissions', [options.permission]),
    ApiOperation({
      summary: options.summary,
      description: options.description,
    }),
    ...(options.resource ? [pathId()] : []),
    ...(options.paginated
      ? [
          ApiQuery({
            name: 'cursor',
            required: false,
            schema: { type: 'string' },
          }),
          ApiQuery({
            name: 'page_size',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 25 },
          }),
        ]
      : []),
    ...(options.body
      ? [
          ApiHeader({
            name: operationKey.toLowerCase(),
            required: true,
            schema: {
              type: 'string',
              minLength: 16,
              maxLength: 128,
              pattern: '^[A-Za-z0-9_-]{16,128}$',
            },
          }),
          ApiBody({
            schema: z.toJSONSchema(options.body, {
              target: 'openapi-3.0',
            }) as SchemaObject,
          }),
          ticketProblem(
            409,
            'Conflict or unresolved outcome. Reuse the same operation key for recovery.',
          ),
        ]
      : []),
    ApiResponse({
      status: options.created ? 201 : 200,
      schema: responseSchema(options.data, options.paginated ?? false),
    }),
    ticketProblem(400, 'Invalid request or reference.'),
    ticketProblem(401, 'Human session required.'),
    ticketProblem(403, 'Actor or permission denied.'),
    ...(options.resource
      ? [ticketProblem(404, 'Ticket not found or inaccessible.')]
      : []),
    ticketProblem(503, 'Ticket dependency unavailable.'),
  );
}

export function operation(actor: TicketActorDto, key: string | undefined) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
    throw new BadRequestException('A valid Idempotency-Key is required');
  return { actor: actor.userId, key };
}

export function cursor(value: string | undefined) {
  if (!value) return 0;
  const decoded = Buffer.from(value, 'base64url').toString();
  if (
    !/^[1-9][0-9]{0,15}$/.test(decoded) ||
    !Number.isSafeInteger(Number(decoded)) ||
    Buffer.from(decoded).toString('base64url') !== value
  )
    throw new BadRequestException('Invalid cursor');
  return Number(decoded);
}

export function nextCursor(next: number | null) {
  return next === null ? null : Buffer.from(String(next)).toString('base64url');
}

function linksView(links: {
  incidentId: string | null;
  assetIds: readonly string[];
  maintenanceIds: readonly string[];
}) {
  return {
    incident_id: links.incidentId,
    asset_ids: links.assetIds,
    maintenance_activity_ids: links.maintenanceIds,
  };
}

@ApiTags('Tickets')
@ApiBearerAuth('HumanAccessToken')
@Controller('tickets')
export class TicketWorkflowController {
  constructor(private readonly workflow: TicketWorkflow) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ticketOperation({
    summary: 'List currently visible Tickets',
    permission: 'ticket:read',
    data: detailResponse,
    paginated: true,
  })
  @ApiQuery({
    name: 'state',
    required: false,
    enum: ['NEW', 'OPEN', 'PENDING', 'CLOSED'],
  })
  @ApiQuery({ name: 'priority_id', required: false, type: Number })
  @ApiQuery({ name: 'business_owner_user_id', required: false, type: String })
  @ApiQuery({ name: 'assignee_user_id', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  async list(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Query() query: TicketListQueryDto,
  ) {
    const result = await ticketRequest(() =>
      this.workflow.list(actor.userId, {
        ...query,
        after: cursor(query.cursor),
        page_size: Number(query.page_size ?? 20),
        priority_id: query.priority_id ? Number(query.priority_id) : undefined,
      }),
    );
    return createPaginatedResult(result.tickets.map(ticketDetail), {
      type: 'cursor',
      next_cursor: nextCursor(result.next),
    });
  }

  @Post()
  @ticketOperation({
    summary: 'Create a manual Ticket',
    description:
      'Manual creation and validated Asset links are supported. A non-null Incident ID requires the owning Incident contract and returns 503 when the provider is unavailable.',
    permission: 'ticket:create',
    data: detailResponse,
    created: true,
    body: createTicketSchema,
  })
  async create(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Headers(operationKey.toLowerCase()) key: string,
    @Body() body: CreateTicketDto,
  ) {
    return ticketDetail(
      await ticketRequest(() =>
        this.workflow.create(operation(actor, key), body),
      ),
    );
  }

  @Post('from-reviewed-draft')
  @ticketOperation({
    summary: 'Confirm reviewed Incident draft (requires owning module)',
    description:
      'Requires an approved Incident provider for reviewed draft freshness, authorization and duplicate confirmation. Returns 503 when the provider is unavailable.',
    permission: 'ticket:create',
    data: detailResponse,
    created: true,
    body: draftSchema,
  })
  async fromDraft(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Headers(operationKey.toLowerCase()) key: string,
    @Body() body: ReviewedDraftDto,
  ) {
    return ticketDetail(
      await ticketRequest(() =>
        this.workflow.createReviewedDraft(operation(actor, key), body),
      ),
    );
  }

  @Patch(':ticket_id/responsibilities')
  @ticketOperation({
    summary: 'Change Business Owner or Assignee independently',
    permission: 'ticket:manage',
    resource: true,
    data: detailResponse,
    body: responsibilitySchema,
  })
  async responsibilities(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Headers(operationKey.toLowerCase()) key: string,
    @Param() params: TicketParamsDto,
    @Body() body: ResponsibilitiesDto,
  ) {
    return ticketDetail(
      await ticketRequest(() =>
        this.workflow.responsibilities(
          operation(actor, key),
          Number(params.ticket_id),
          body,
        ),
      ),
    );
  }

  @Patch(':ticket_id')
  @ticketOperation({
    summary: 'Update title or priority',
    permission: 'ticket:manage',
    resource: true,
    data: detailResponse,
    body: informationSchema,
  })
  async information(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Headers(operationKey.toLowerCase()) key: string,
    @Param() params: TicketParamsDto,
    @Body() body: TicketInformationDto,
  ) {
    return ticketDetail(
      await ticketRequest(() =>
        this.workflow.updateInformation(
          operation(actor, key),
          Number(params.ticket_id),
          body,
        ),
      ),
    );
  }

  @Post(':ticket_id/status')
  @HttpCode(200)
  @ticketOperation({
    summary: 'Perform a non-terminal progress transition',
    permission: 'ticket:work',
    resource: true,
    data: detailResponse,
    body: transitionSchema,
  })
  async status(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Headers(operationKey.toLowerCase()) key: string,
    @Param() params: TicketParamsDto,
    @Body() body: TicketTransitionDto,
  ) {
    return ticketDetail(
      await ticketRequest(() =>
        this.workflow.transition(
          operation(actor, key),
          Number(params.ticket_id),
          body,
        ),
      ),
    );
  }

  @Get(':ticket_id/articles')
  @Header('Cache-Control', 'no-store')
  @ticketOperation({
    summary: 'Page through authorized Ticket Articles',
    permission: 'ticket:read',
    resource: true,
    data: articleResponse,
    paginated: true,
  })
  async articles(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Param() params: TicketParamsDto,
    @Query() query: TicketArticleQueryDto,
  ) {
    const result = await ticketRequest(() =>
      this.workflow.articlePage(
        actor.userId,
        Number(params.ticket_id),
        cursor(query.cursor),
        Number(query.page_size ?? 20),
      ),
    );
    return createPaginatedResult(
      result.articles.map((article) => ({
        article_id: article.id,
        type: article.type,
        internal: article.internal,
        body_text: article.text,
        created_at: article.createdAt,
      })),
      { type: 'cursor', next_cursor: nextCursor(result.next) },
    );
  }

  @Post(':ticket_id/articles')
  @ticketOperation({
    summary: 'Append an internal plain text note',
    permission: 'ticket:work',
    resource: true,
    created: true,
    data: articleReceipt,
    body: articleSchema,
  })
  async appendArticle(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Headers(operationKey.toLowerCase()) key: string,
    @Param() params: TicketParamsDto,
    @Body() body: TicketArticleDto,
  ) {
    const result = await ticketRequest(() =>
      this.workflow.appendArticle(
        operation(actor, key),
        Number(params.ticket_id),
        body.body,
      ),
    );
    return { ticket_id: result.ticketId, article_id: result.articleId };
  }

  @Post(':ticket_id/close')
  @HttpCode(200)
  @ticketOperation({
    summary: 'Close a Ticket as its current Business Owner',
    permission: 'ticket:close',
    resource: true,
    data: detailResponse,
    body: closeSchema,
  })
  async close(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Headers(operationKey.toLowerCase()) key: string,
    @Param() params: TicketParamsDto,
    @Body() body: CloseTicketDto,
  ) {
    return ticketDetail(
      await ticketRequest(() =>
        this.workflow.close(
          operation(actor, key),
          Number(params.ticket_id),
          body.outcome,
        ),
      ),
    );
  }

  @Post(':ticket_id/reopen')
  @HttpCode(200)
  @ticketOperation({
    summary: 'Reopen the existing closed Ticket',
    permission: 'ticket:manage',
    resource: true,
    data: detailResponse,
    body: reopenSchema,
  })
  async reopen(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Headers(operationKey.toLowerCase()) key: string,
    @Param() params: TicketParamsDto,
    @Body() body: ReopenTicketDto,
  ) {
    return ticketDetail(
      await ticketRequest(() =>
        this.workflow.reopen(
          operation(actor, key),
          Number(params.ticket_id),
          body.reason,
        ),
      ),
    );
  }

  @Get(':ticket_id/links')
  @Header('Cache-Control', 'no-store')
  @ticketOperation({
    summary: 'Read visible Ticket business links',
    description:
      'Returns visible links, with Incident and Maintenance references included only when the owning provider validates them for the current actor.',
    permission: 'ticket:read',
    resource: true,
    data: linksResponse,
  })
  async links(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Param() params: TicketParamsDto,
  ) {
    return linksView(
      await ticketRequest(() =>
        this.workflow.getLinks(actor.userId, Number(params.ticket_id)),
      ),
    );
  }

  @Patch(':ticket_id/links')
  @ticketOperation({
    summary: 'Change validated Ticket business links',
    description:
      'Asset updates and clearing the primary Incident link are supported. A non-null Incident ID requires the owning Incident contract and returns 503 when the provider is unavailable. Maintenance attachment is not part of this endpoint.',
    permission: 'ticket:manage',
    resource: true,
    data: linksResponse,
    body: linksSchema,
  })
  async setLinks(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Headers(operationKey.toLowerCase()) key: string,
    @Param() params: TicketParamsDto,
    @Body() body: TicketLinksDto,
  ) {
    return linksView(
      await ticketRequest(() =>
        this.workflow.setLinks(
          operation(actor, key),
          Number(params.ticket_id),
          {
            incidentId: body.incident_id,
            assetIds: body.asset_ids,
          },
        ),
      ),
    );
  }
}

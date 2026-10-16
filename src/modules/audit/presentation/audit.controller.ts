import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { createPaginatedResult } from '@platform/http/api/pagination/paginated-result';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuditRecordView } from '../domain/audit-query';
import { GetAuditEventUseCase } from '../application/get-audit-event.use-case';
import { ListAuditEventsUseCase } from '../application/list-audit-events.use-case';
import {
  decodeAuditCursor,
  encodeAuditCursor,
  InvalidAuditCursorError,
} from '../application/audit-cursor';
import { auditEventListQuerySchema } from './audit-event-query.schema';
import { RequirePermissions } from '@modules/iam';
import { z, ZodError } from 'zod';

const auditEventIdParamsSchema = z
  .object({ event_id: z.string().trim().min(1) })
  .strict();

/** Declares the query schema metadata required by the strict global validation pipe. */
class AuditEventListQueryRequestDto extends createZodDto(
  auditEventListQuerySchema,
) {}

/** Declares the path schema metadata required by the strict global validation pipe. */
class AuditEventIdParamsDto extends createZodDto(auditEventIdParamsSchema) {}

/** Read-only HTTP endpoints for immutable Audit events. */
@Controller('audit/events')
@RequirePermissions('audit:read')
@ApiTags('Audit')
@ApiBearerAuth('HumanAccessToken')
@ApiUnauthorizedResponse({ description: 'Access token is missing or invalid.' })
@ApiForbiddenResponse({
  description: 'The caller lacks audit:read permission.',
})
export class AuditController {
  constructor(
    private readonly listEvents: ListAuditEventsUseCase,
    private readonly getEvent: GetAuditEventUseCase,
  ) {}

  @Get()
  async list(@Query() rawQuery: AuditEventListQueryRequestDto) {
    let query;
    try {
      query = auditEventListQuerySchema.parse(rawQuery);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({ message: 'Invalid audit query' });
      }
      throw error;
    }
    let cursor;
    try {
      cursor = query.cursor ? decodeAuditCursor(query.cursor) : undefined;
    } catch (error) {
      if (error instanceof InvalidAuditCursorError) {
        throw new BadRequestException('Audit cursor is invalid');
      }
      throw error;
    }
    const page = await this.listEvents.execute({
      pageSize: query.page_size,
      cursor,
      filters: {
        occurredFrom: query.occurred_from
          ? new Date(query.occurred_from)
          : undefined,
        occurredTo: query.occurred_to ? new Date(query.occurred_to) : undefined,
        actorId: query.actor_id,
        action: query.action,
        resourceType: query.resource_type,
        resourceId: query.resource_id,
        requestId: query.request_id,
      },
    });
    return createPaginatedResult(page.items.map(serializeAuditRecord), {
      type: 'cursor',
      next_cursor: page.nextCursor ? encodeAuditCursor(page.nextCursor) : null,
    });
  }

  @Get(':event_id')
  async get(@Param() rawParams: AuditEventIdParamsDto) {
    const record = await this.getEvent.execute(rawParams.event_id);
    if (!record) throw new NotFoundException('Audit event not found');
    return serializeAuditRecord(record);
  }
}

function serializeAuditRecord(record: AuditRecordView) {
  return {
    event_id: record.eventId,
    event_type: record.eventType,
    event_schema_version: record.eventVersion,
    occurred_at: record.occurredAt.toISOString(),
    recorded_at: record.recordedAt.toISOString(),
    actor: record.actor,
    action: record.action,
    resource: record.resource,
    changes: record.changes.map((change) => ({ ...change })),
    context: record.context,
  };
}

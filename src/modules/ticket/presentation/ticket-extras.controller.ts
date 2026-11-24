import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExtension,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { Request } from 'express';
import { CurrentHumanPrincipal, RequirePermissions } from '@modules/iam';
import { RawResponse } from '@platform/http/api';
import { createPaginatedResult } from '@platform/http/api/pagination/paginated-result';
import { TicketWorkflow } from '../application/ticket-workflow';
import {
  TicketEvidence,
  evidenceLimit,
  uploadEvidenceSchema,
} from '../application/ticket-evidence';
import {
  TicketOperationError,
  type TicketArchiveRecord,
  type TicketEvidenceRecord,
} from '../application/ticket-journal';
import {
  TicketActorDto,
  TicketParamsDto,
  detailResponse,
  ticketDetail,
  ticketRequest,
} from './ticket.controller';
import {
  cursor,
  nextCursor,
  operation,
  ticketOperation,
} from './ticket-workflow.controller';
import { TicketArticleQueryDto } from './ticket-workflow.schemas';

class EligibleUsersQuery extends createZodDto(
  z.strictObject({
    cursor: z
      .string()
      .regex(/^[a-f0-9]{24}$/)
      .optional(),
    page_size: z
      .string()
      .regex(/^(?:[1-9]|1[0-9]|2[0-5])$/)
      .optional(),
    search: z.string().trim().min(1).max(80).optional(),
  }),
) {}

const note = z.strictObject({ reason: z.string().trim().min(1).max(500) });
class ArchiveDto extends createZodDto(note) {}
class UploadDto extends createZodDto(uploadEvidenceSchema) {}
const grant = z.string().min(1).max(2048);
const grantSchema = z.strictObject({ grant });
class EvidenceGrantDto extends createZodDto(grantSchema) {}
class EvidenceAccessDto extends createZodDto(
  z.strictObject({ disposition: z.enum(['inline', 'attachment']) }),
) {}
class EvidenceParamsDto extends createZodDto(
  z.strictObject({
    ticket_id: z
      .string()
      .regex(/^[1-9][0-9]{0,15}$/)
      .refine((value) => Number.isSafeInteger(Number(value))),
    evidence_id: z.uuid(),
  }),
) {}
class EvidenceListDto extends createZodDto(
  z.strictObject({
    cursor: z.uuid().optional(),
    page_size: z
      .string()
      .regex(/^[1-9][0-9]?$/)
      .refine((value) => Number(value) <= 25)
      .optional(),
  }),
) {}
const archiveSchema = {
  type: 'object',
  required: [
    'ticket_id',
    'archived',
    'version',
    'archived_at',
    'archive_reason',
  ],
  properties: {
    ticket_id: { type: 'integer' },
    archived: { type: 'boolean' },
    version: { type: 'integer' },
    archived_at: { type: 'string', format: 'date-time' },
    archive_reason: { type: 'string' },
    restored_at: { type: 'string', format: 'date-time' },
    restore_reason: { type: 'string' },
  },
};
const evidenceSchema = {
  type: 'object',
  required: ['id', 'file_name', 'mime_type', 'file_size', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    file_name: { type: 'string' },
    mime_type: { type: 'string' },
    file_size: { type: 'integer' },
    created_at: { type: 'string', format: 'date-time' },
  },
};
const archiveView = (row: TicketArchiveRecord) => ({
  ticket_id: row.ticketId,
  archived: row.active,
  version: row.version,
  archived_at: row.archivedAt,
  archive_reason: row.archiveReason,
  ...(row.restoredAt
    ? { restored_at: row.restoredAt, restore_reason: row.restoreReason }
    : {}),
});
const evidenceView = (row: TicketEvidenceRecord) => ({
  id: row.id,
  file_name: row.fileName,
  mime_type: row.mimeType,
  file_size: row.fileSize,
  created_at: row.createdAt,
});

@ApiTags('Tickets')
@ApiBearerAuth('HumanAccessToken')
@Controller('tickets')
export class TicketExtrasController {
  constructor(
    private readonly workflow: TicketWorkflow,
    private readonly evidence: TicketEvidence,
  ) {}

  @Get('metadata/priorities')
  @Header('Cache-Control', 'no-store')
  @ticketOperation({
    summary: 'Read active priorities from the selected Zammad catalog',
    permission: 'ticket:read',
    data: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          label: { type: 'string' },
          color: {
            type: 'string',
            enum: ['green', 'cyan', 'amber', 'critical', 'neutral'],
          },
        },
      },
    },
  })
  priorities(@CurrentHumanPrincipal() actor: TicketActorDto) {
    return ticketRequest(() => this.workflow.priorities(actor.userId));
  }

  @Get('eligible-users')
  @Header('Cache-Control', 'no-store')
  @ApiQuery({
    name: 'search',
    required: false,
    schema: { type: 'string', minLength: 1, maxLength: 80 },
  })
  @ticketOperation({
    summary: 'Search scoped eligible Ticket Owners and Assignees',
    permission: 'ticket:manage',
    paginated: true,
    data: {
      type: 'object',
      required: ['id', 'username', 'display_name', 'role', 'status'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        username: { type: 'string' },
        display_name: { type: 'string', nullable: true },
        role: { type: 'string', enum: ['OPERATOR', 'TECHNICIAN'] },
        status: { type: 'string', enum: ['ACTIVE'] },
      },
    },
  })
  eligibleUsers(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Query() query: EligibleUsersQuery,
  ) {
    return ticketRequest(async () => {
      const result = await this.workflow.eligibleUsers(
        actor.userId,
        query.search ?? '',
        Number(query.page_size ?? 10),
        query.cursor,
      );
      return createPaginatedResult(result.items, {
        type: 'cursor',
        next_cursor: result.next,
      });
    });
  }

  @Get('archived')
  @Header('Cache-Control', 'no-store')
  @ticketOperation({
    summary: 'List archived Tickets for an authorized Operator',
    permission: 'ticket:manage',
    data: {
      ...detailResponse,
      required: [...(detailResponse.required ?? []), 'archive'],
      properties: { ...detailResponse.properties, archive: archiveSchema },
    },
    paginated: true,
  })
  archived(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Query() query: TicketArticleQueryDto,
  ) {
    return ticketRequest(async () => {
      const result = await this.workflow.archived(
        actor.userId,
        cursor(query.cursor),
        Number(query.page_size ?? 20),
      );
      return createPaginatedResult(
        result.items.map((item) => ({
          ...ticketDetail(item.ticket),
          archive: archiveView(item.record),
        })),
        { type: 'cursor', next_cursor: nextCursor(result.next) },
      );
    });
  }

  @Post(':ticket_id/archive')
  @HttpCode(200)
  @ticketOperation({
    summary: 'Archive a Ticket in Core and retain canonical data',
    permission: 'ticket:manage',
    data: archiveSchema,
    body: note,
    resource: true,
  })
  archive(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Param() params: TicketParamsDto,
    @Body() body: ArchiveDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return ticketRequest(async () =>
      archiveView(
        await this.workflow.archive(
          operation(actor, key),
          Number(params.ticket_id),
          body.reason,
          true,
        ),
      ),
    );
  }

  @Post(':ticket_id/restore')
  @HttpCode(200)
  @ticketOperation({
    summary: 'Restore a Ticket to ordinary Core visibility',
    permission: 'ticket:manage',
    data: archiveSchema,
    body: note,
    resource: true,
  })
  restore(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Param() params: TicketParamsDto,
    @Body() body: ArchiveDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return ticketRequest(async () =>
      archiveView(
        await this.workflow.archive(
          operation(actor, key),
          Number(params.ticket_id),
          body.reason,
          false,
        ),
      ),
    );
  }

  @Get(':ticket_id/evidence')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('ticket:read')
  @ApiExtension('x-required-permissions', ['ticket:read'])
  @ApiOperation({ summary: 'List finalized Ticket Evidence' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            upload_available: { type: 'boolean' },
            items: { type: 'array', items: evidenceSchema },
            next_cursor: { type: 'string', nullable: true },
          },
        },
      },
    },
  })
  list(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Param() params: TicketParamsDto,
    @Query() query: EvidenceListDto,
  ) {
    return ticketRequest(async () => {
      const result = await this.evidence.list(
        actor.userId,
        Number(params.ticket_id),
        query.cursor ?? '',
        Number(query.page_size ?? 20),
      );
      return {
        upload_available: result.enabled,
        items: result.items.map(evidenceView),
        next_cursor: result.next,
      };
    });
  }

  @Post(':ticket_id/evidence/uploads')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('ticket:work')
  @ApiExtension('x-required-permissions', ['ticket:work'])
  @ApiOperation({
    summary: 'Issue an actor- and Ticket-bound 10 minute upload grant',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file_name', 'mime_type', 'file_size'],
      properties: {
        file_name: { type: 'string', maxLength: 160 },
        mime_type: {
          type: 'string',
          enum: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
        },
        file_size: { type: 'integer', minimum: 1, maximum: evidenceLimit },
      },
    },
  })
  authorizeUpload(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Param() params: TicketParamsDto,
    @Body() file: UploadDto,
  ) {
    return ticketRequest(() =>
      this.evidence.grant(actor.userId, Number(params.ticket_id), file),
    );
  }

  @Put(':ticket_id/evidence/uploads')
  @RequirePermissions('ticket:work')
  @ApiExtension('x-required-permissions', ['ticket:work'])
  @ApiOperation({ summary: 'Write bounded bytes to a private staging object' })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiHeader({ name: 'x-evidence-grant', required: true })
  upload(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Param() params: TicketParamsDto,
    @Req() req: Request,
    @Headers('x-evidence-grant') token?: string,
  ) {
    return ticketRequest(() =>
      this.evidence.write(
        actor.userId,
        Number(params.ticket_id),
        token ?? '',
        () => readUpload(req),
      ),
    );
  }

  @Post(':ticket_id/evidence/finalize')
  @ticketOperation({
    summary: 'Verify uploaded bytes and atomically record Evidence and Audit',
    permission: 'ticket:work',
    data: evidenceSchema,
    body: grantSchema,
    resource: true,
    created: true,
  })
  finalize(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Param() params: TicketParamsDto,
    @Body() body: EvidenceGrantDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return ticketRequest(async () =>
      evidenceView(
        await this.evidence.finalize(
          operation(actor, key),
          Number(params.ticket_id),
          body.grant,
        ),
      ),
    );
  }

  @Post(':ticket_id/evidence/:evidence_id/access')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('ticket:read')
  @ApiExtension('x-required-permissions', ['ticket:read'])
  @ApiOperation({
    summary: 'Issue a 60 second read grant for one Evidence record',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['disposition'],
      properties: {
        disposition: { type: 'string', enum: ['inline', 'attachment'] },
      },
    },
  })
  authorizeRead(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Param() params: EvidenceParamsDto,
    @Body() body: EvidenceAccessDto,
  ) {
    return ticketRequest(() =>
      this.evidence.access(
        actor.userId,
        Number(params.ticket_id),
        params.evidence_id,
        body.disposition,
      ),
    );
  }

  @Post(':ticket_id/evidence/:evidence_id/content')
  @HttpCode(200)
  @RawResponse()
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "sandbox; default-src 'none'")
  @RequirePermissions('ticket:read')
  @ApiExtension('x-required-permissions', ['ticket:read'])
  @ApiOperation({ summary: 'Retrieve protected image or attachment bytes' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['grant'],
      properties: { grant: { type: 'string' } },
    },
  })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  content(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Param() params: EvidenceParamsDto,
    @Body() body: EvidenceGrantDto,
  ) {
    return ticketRequest(async () => {
      const { row, bytes, disposition } = await this.evidence.content(
        actor.userId,
        Number(params.ticket_id),
        params.evidence_id,
        body.grant,
      );
      return new StreamableFile(bytes, {
        type: row.mimeType,
        length: bytes.length,
        disposition:
          disposition +
          "; filename*=UTF-8''" +
          encodeURIComponent(
            Buffer.from(row.fileName, 'utf8').toString('utf8'),
          ).replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16)),
      });
    });
  }
}

async function readUpload(request: Request) {
  if (request.headers['content-type'] !== 'application/octet-stream')
    throw new TicketOperationError('INVALID_FILE');
  const declared = request.headers['content-length'];
  if (declared && Number(declared) > evidenceLimit) {
    request.resume();
    throw new TicketOperationError('TOO_LARGE');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({
    destroyOnReturn: false,
  }) as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > evidenceLimit) {
      request.resume();
      throw new TicketOperationError('TOO_LARGE');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

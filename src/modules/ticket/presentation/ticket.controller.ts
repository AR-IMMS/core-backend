import {
  Controller,
  Get,
  Header,
  HttpException,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtension,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentHumanPrincipal, RequirePermissions } from '@modules/iam';
import { GetAuthorizedTicket } from '../application/get-authorized-ticket';
import type { ExternalTicket } from '../application/ticket-read.port';
import { TicketOperationError } from '../application/ticket-journal';

const ticketId = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/)
  .refine((value) => Number.isSafeInteger(Number(value)));
export class TicketParamsDto extends createZodDto(
  z.strictObject({ ticket_id: ticketId }),
) {}
class EmptyTicketQueryDto extends createZodDto(z.strictObject({})) {}
// The global strict pipe also validates custom parameter decorators.
export class TicketActorDto extends createZodDto(
  z.object({ userId: z.string().min(1) }),
) {}

const detailProperties = {
  ticket_id: { type: 'integer' },
  number: { type: 'string' },
  title: { type: 'string' },
  state_id: { type: 'integer' },
  priority_id: { type: 'integer' },
  created_at: { type: 'string', format: 'date-time' },
  updated_at: { type: 'string', format: 'date-time' },
} as const;

export const detailResponse: SchemaObject = {
  type: 'object',
  required: Object.keys(detailProperties),
  properties: detailProperties,
};

const problemSchema: SchemaObject = {
  type: 'object',
  required: [
    'type',
    'title',
    'status',
    'detail',
    'instance',
    'code',
    'request_id',
  ],
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string' },
    instance: { type: 'string' },
    code: { type: 'string' },
    request_id: { type: 'string' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'array', items: { type: 'string' } },
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
};

export function ticketProblem(status: number, description: string) {
  return ApiResponse({
    status,
    description,
    content: { 'application/problem+json': { schema: problemSchema } },
  });
}

export function ticketDetail(ticket: ExternalTicket) {
  return {
    ticket_id: ticket.externalTicketId,
    number: ticket.number,
    title: ticket.title,
    state_id: ticket.stateId,
    priority_id: ticket.priorityId,
    created_at: ticket.createdAt,
    updated_at: ticket.updatedAt,
  };
}

export async function ticketRequest<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    if (error instanceof TicketOperationError) {
      const responses = {
        DENIED: [403, 'Ticket operation denied'],
        NOT_FOUND: [404, 'Ticket not found'],
        INVALID: [400, 'Invalid Ticket operation or reference'],
        CONFLICT: [
          409,
          'Ticket operation conflicts with the current state or request key',
        ],
        UNRESOLVED: [
          409,
          'Ticket operation outcome is unresolved. Reuse the same request key',
        ],
        UNAVAILABLE: [503, 'Ticket dependency is unavailable'],
      } as const;
      const [status, message] = responses[error.code];
      throw new HttpException(
        { message, code: `TICKET_${error.code}` },
        status,
      );
    }
    throw new HttpException('Ticket dependency is unavailable', 503);
  }
}

@ApiTags('Tickets')
@ApiBearerAuth('HumanAccessToken')
@Controller('tickets')
export class TicketController {
  constructor(private readonly query: GetAuthorizedTicket) {}

  @Get(':ticket_id')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('ticket:read')
  @ApiExtension('x-required-permissions', ['ticket:read'])
  @ApiParam({
    name: 'ticket_id',
    schema: { type: 'string', pattern: '^[1-9][0-9]{0,15}$' },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['data', 'meta'],
      properties: {
        data: detailResponse,
        meta: {
          type: 'object',
          properties: {
            request_id: { type: 'string' },
            trace_id: { type: 'string' },
          },
        },
      },
    },
  })
  @ticketProblem(400, 'Invalid Ticket identifier or unsupported query.')
  @ticketProblem(401, 'Human session required.')
  @ticketProblem(403, 'Required IAM capability unavailable.')
  @ticketProblem(404, 'Ticket not found or inaccessible.')
  @ticketProblem(503, 'Ticket dependency unavailable.')
  async detail(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Param() params: TicketParamsDto,
    @Query() query: EmptyTicketQueryDto,
  ) {
    // The global strict pipe validates the empty query before this method runs.
    void query;
    const result = await ticketRequest(() =>
      this.query.execute(actor.userId, Number(params.ticket_id)),
    );
    if (result.status !== 'allowed')
      throw new NotFoundException('Ticket not found');
    return ticketDetail(result.ticket);
  }
}

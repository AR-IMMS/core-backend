import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiExtension,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentHumanPrincipal, RequirePermissions } from '@modules/iam';
import {
  TicketNotifications,
  ticketNotificationKinds,
  ticketNotificationLimit,
} from '../application/ticket-notifications';
import {
  TicketActorDto,
  ticketProblem,
  ticketRequest,
} from './ticket.controller';

class NotificationQuery extends createZodDto(z.strictObject({})) {}
class ReadNotificationsDto extends createZodDto(
  z.strictObject({
    ids: z
      .array(z.uuid())
      .min(1)
      .max(ticketNotificationLimit)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
) {}

const itemProperties: Record<string, SchemaObject> = {
  id: { type: 'string', format: 'uuid' },
  kind: { type: 'string', enum: [...ticketNotificationKinds] },
  ticket_id: { type: 'integer' },
  ticket_number: { type: 'string' },
  ticket_title: { type: 'string' },
  occurred_at: { type: 'string', format: 'date-time' },
  read: { type: 'boolean' },
};

function envelope(properties: Record<string, SchemaObject>): SchemaObject {
  return {
    type: 'object',
    required: ['data', 'meta'],
    properties: {
      data: { type: 'object', properties, required: Object.keys(properties) },
      meta: {
        type: 'object',
        properties: {
          request_id: { type: 'string' },
          trace_id: { type: 'string' },
        },
      },
    },
  };
}

@ApiTags('Tickets')
@ApiBearerAuth('HumanAccessToken')
@Controller('ticket-notifications')
export class TicketNotificationsController {
  constructor(private readonly notifications: TicketNotifications) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('ticket:read')
  @ApiExtension('x-required-permissions', ['ticket:read'])
  @ApiOperation({
    summary:
      'List recent visible Ticket notifications for the current recipient',
  })
  @ApiOkResponse({
    schema: envelope({
      items: {
        type: 'array',
        maxItems: ticketNotificationLimit,
        items: {
          type: 'object',
          required: Object.keys(itemProperties),
          properties: itemProperties,
        },
      },
      unread_count: {
        type: 'integer',
        minimum: 0,
        maximum: ticketNotificationLimit,
      },
    }),
  })
  @ticketProblem(400, 'Unsupported query.')
  @ticketProblem(401, 'Human session required.')
  @ticketProblem(403, 'Ticket notification access denied.')
  @ticketProblem(503, 'Ticket dependency unavailable.')
  list(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Query() query: NotificationQuery,
  ) {
    void query;
    return ticketRequest(() => this.notifications.list(actor.userId));
  }

  @Post('read')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('ticket:read')
  @ApiExtension('x-required-permissions', ['ticket:read'])
  @ApiOperation({
    summary: 'Mark the supplied visible Ticket notifications as read',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['ids'],
      additionalProperties: false,
      properties: {
        ids: {
          type: 'array',
          minItems: 1,
          maxItems: ticketNotificationLimit,
          uniqueItems: true,
          items: { type: 'string', format: 'uuid' },
        },
      },
    },
  })
  @ApiOkResponse({
    schema: envelope({ updated_count: { type: 'integer', minimum: 0 } }),
  })
  @ticketProblem(400, 'Invalid notification identifiers or unsupported query.')
  @ticketProblem(401, 'Human session required.')
  @ticketProblem(403, 'Ticket notification access denied.')
  @ticketProblem(404, 'A notification is missing or inaccessible.')
  @ticketProblem(503, 'Ticket dependency unavailable.')
  markRead(
    @CurrentHumanPrincipal() actor: TicketActorDto,
    @Body() body: ReadNotificationsDto,
    @Query() query: NotificationQuery,
  ) {
    void query;
    return ticketRequest(() =>
      this.notifications.markRead(actor.userId, body.ids),
    );
  }
}

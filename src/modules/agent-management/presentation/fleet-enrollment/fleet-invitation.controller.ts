import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  Headers,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentHumanPrincipal,
  RequirePermissions,
} from '@modules/iam/presentation/authorization.decorators';
import type { AuthenticatedHumanContext } from '@modules/iam/presentation/authorization.decorators';
import { getRequestId } from '@platform/http/request-context/request-id';
import {
  FleetConflictError,
  FleetProtocolError,
  FleetUnavailableError,
} from '../../application/fleet/errors/fleet-errors';
import { FleetOperationPendingError } from '../../application/fleet/errors/fleet-operation-pending.error';
import { RequestFleetInvitationUseCase } from '../../application/fleet/use-cases/request-fleet-invitation.use-case';
import {
  AgentNodeNotEligibleError,
  AgentNodeNotFoundError,
} from '../../domain/errors/registration.errors';

const nodeParamsSchema = z.object({ nodeId: z.uuid() }).strict();
class NodeParamsDto extends createZodDto(nodeParamsSchema) {}

@ApiTags('Fleet Enrollment')
@ApiBearerAuth('HumanAccessToken')
@Controller('nodes/:nodeId/agent-fleet-invitations')
export class FleetInvitationController {
  constructor(
    private readonly requestInvitation: RequestFleetInvitationUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('agent:manage')
  @ApiOperation({ summary: 'Request a Fleet enrollment invitation for a Node' })
  @ApiParam({ name: 'nodeId', format: 'uuid' })
  @ApiCreatedResponse({ description: 'Fleet invitation operation accepted.' })
  @ApiNotFoundResponse({ description: 'Node does not exist.' })
  async create(
    @Param() params: NodeParamsDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentHumanPrincipal() principal: AuthenticatedHumanContext,
    @Req() request: { id?: unknown },
    @Res({ passthrough: true }) response: ServerResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    if (!isIdempotencyKey(idempotencyKey)) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }
    try {
      const result = await this.requestInvitation.execute({
        nodeId: params.nodeId,
        idempotencyKey,
        actor: { actorId: principal.userId, requestId: getRequestId(request) },
      });
      return {
        operation_id: result.operationId,
        ...(result.invitationId ? { invitation_id: result.invitationId } : {}),
        ...(result.nodeId ? { node_id: result.nodeId } : {}),
        status: result.status,
        ...(result.expiresAt
          ? { expires_at: result.expiresAt.toISOString() }
          : {}),
        ...(result.invitationToken
          ? { invitation_token: result.invitationToken }
          : {}),
        ...(result.installationId
          ? { installation_id: result.installationId }
          : {}),
      };
    } catch (error) {
      if (error instanceof AgentNodeNotFoundError)
        throw new NotFoundException();
      if (error instanceof AgentNodeNotEligibleError) {
        throw new ConflictException({ code: 'NODE_NOT_ELIGIBLE' });
      }
      if (error instanceof FleetConflictError) {
        throw new ConflictException({ code: error.code });
      }
      if (error instanceof FleetOperationPendingError) {
        throw new ServiceUnavailableException({
          code: 'FLEET_OPERATION_PENDING',
          operation_id: error.operationId,
          stage: error.stage,
        });
      }
      if (error instanceof FleetUnavailableError) {
        throw new ServiceUnavailableException({ code: 'FLEET_UNAVAILABLE' });
      }
      if (error instanceof FleetProtocolError) {
        throw new BadGatewayException({ code: 'FLEET_INVALID_RESPONSE' });
      }
      throw error;
    }
  }
}

function isIdempotencyKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

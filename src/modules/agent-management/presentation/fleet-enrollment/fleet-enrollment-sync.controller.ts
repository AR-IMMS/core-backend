import {
  BadGatewayException,
  ConflictException,
  Controller,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ApiBearerAuth,
  ApiOkResponse,
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
  FleetNotFoundError,
  FleetProtocolError,
  FleetUnavailableError,
} from '../../application/fleet/errors/fleet-errors';
import { FleetOperationPendingError } from '../../application/fleet/errors/fleet-operation-pending.error';
import { SynchronizeFleetEnrollmentUseCase } from '../../application/fleet/use-cases/synchronize-fleet-enrollment.use-case';

const invitationParamsSchema = z
  .object({ invitationId: z.string().min(1).max(128) })
  .strict();
class InvitationParamsDto extends createZodDto(invitationParamsSchema) {}

@ApiTags('Fleet Enrollment')
@ApiBearerAuth('HumanAccessToken')
@Controller('agent-fleet-invitations')
export class FleetEnrollmentSyncController {
  constructor(
    private readonly synchronize: SynchronizeFleetEnrollmentUseCase,
  ) {}

  @Post(':invitationId/synchronize')
  @RequirePermissions('agent:manage')
  @ApiOperation({
    summary: 'Synchronize Fleet registration into Core Node binding',
  })
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiOkResponse({ description: 'Fleet invitation status synchronized.' })
  async synchronizeInvitation(
    @Param() params: InvitationParamsDto,
    @CurrentHumanPrincipal() principal: AuthenticatedHumanContext,
    @Req() request: { id?: unknown },
  ) {
    try {
      const result = await this.synchronize.execute({
        invitationId: params.invitationId,
        actor: { actorId: principal.userId, requestId: getRequestId(request) },
      });
      return {
        operation_id: result.operationId,
        invitation_id: result.invitationId,
        node_id: result.nodeId,
        status: result.status,
        ...(result.installationId
          ? { installation_id: result.installationId }
          : {}),
      };
    } catch (error) {
      if (error instanceof FleetNotFoundError) throw new NotFoundException();
      if (error instanceof FleetConflictError) {
        throw new ConflictException({ code: error.code });
      }
      if (error instanceof FleetOperationPendingError) {
        throw new ServiceUnavailableException({
          code: 'FLEET_SYNC_PENDING',
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

import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  CurrentHumanPrincipal,
  RequirePermissions,
} from '@modules/iam/presentation/authorization.decorators';
import type { AuthenticatedHumanContext } from '@modules/iam/presentation/authorization.decorators';
import { RevokeAgentBindingUseCase } from '../../application/access-lifecycle/use-cases/revoke-agent-binding.use-case';
import { AgentBindingRevocationUnavailableError } from '../../application/access-lifecycle/errors/binding-revocation-unavailable.error';
import { AgentBindingNotFoundError } from '../../domain/errors/agent-binding.errors';

const bindingIdParamsSchema = z.object({ bindingId: z.uuid() }).strict();

class BindingIdParamsDto extends createZodDto(bindingIdParamsSchema) {}

@ApiTags('Agent Bindings')
@ApiBearerAuth('HumanAccessToken')
@Controller('agent-bindings')
export class AgentBindingRevocationController {
  constructor(private readonly revokeBinding: RevokeAgentBindingUseCase) {}

  @Post(':bindingId/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('agent:manage')
  @ApiOperation({ summary: 'Revoke an active Agent binding' })
  @ApiParam({ name: 'bindingId', format: 'uuid' })
  @ApiNoContentResponse({
    description: 'Binding is revoked or already revoked.',
  })
  async revoke(
    @Param() params: BindingIdParamsDto,
    @CurrentHumanPrincipal() principal: AuthenticatedHumanContext,
  ): Promise<void> {
    try {
      await this.revokeBinding.execute({
        bindingId: params.bindingId,
        actorId: principal.userId,
      });
    } catch (error) {
      if (error instanceof AgentBindingNotFoundError) {
        throw new NotFoundException({ code: 'NOT_FOUND' });
      }
      if (error instanceof AgentBindingRevocationUnavailableError) {
        throw new ServiceUnavailableException({
          code: 'AGENT_REVOCATION_UNAVAILABLE',
        });
      }
      throw error;
    }
  }
}

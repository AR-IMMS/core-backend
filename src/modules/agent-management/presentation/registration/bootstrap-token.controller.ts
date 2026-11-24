import {
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
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
  RequirePermissions,
  CurrentHumanPrincipal,
} from '@modules/iam/presentation/authorization.decorators';
import type { AuthenticatedHumanContext } from '@modules/iam/presentation/authorization.decorators';
import { IssueBootstrapTokenUseCase } from '../../application/registration/use-cases/issue-bootstrap-token.use-case';
import { BootstrapTokenIssuanceConflictError } from '../../application/registration/errors/bootstrap-token-issuance-conflict.error';
import {
  AgentNodeNotEligibleError,
  AgentNodeNotFoundError,
} from '../../domain/errors/registration.errors';

const nodeIdParamsSchema = z.object({ nodeId: z.uuid() }).strict();

class NodeIdParamsDto extends createZodDto(nodeIdParamsSchema) {}

@ApiTags('Agent Bootstrap')
@ApiBearerAuth('HumanAccessToken')
@Controller('nodes/:nodeId/agent-bootstrap-tokens')
export class BootstrapTokenController {
  constructor(private readonly issueToken: IssueBootstrapTokenUseCase) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('agent:manage')
  @ApiOperation({ summary: 'Issue a Node-bound single-use bootstrap token' })
  @ApiParam({ name: 'nodeId', format: 'uuid' })
  @ApiCreatedResponse({ description: 'Token created and shown once.' })
  @ApiNotFoundResponse({ description: 'Node does not exist.' })
  async issue(
    @Param() params: NodeIdParamsDto,
    @CurrentHumanPrincipal() principal: AuthenticatedHumanContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.issueToken.execute({
        nodeId: params.nodeId,
        createdBy: principal.userId,
      });
      return {
        token_id: result.tokenId,
        bootstrap_token: result.bootstrapToken,
        node_id: result.nodeId,
        expires_at: result.expiresAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof AgentNodeNotFoundError)
        throw new NotFoundException();
      if (error instanceof AgentNodeNotEligibleError) {
        throw new ConflictException({ code: 'NODE_NOT_ELIGIBLE' });
      }
      if (error instanceof BootstrapTokenIssuanceConflictError) {
        throw new ConflictException({ code: 'CONFLICT' });
      }
      throw error;
    }
  }
}

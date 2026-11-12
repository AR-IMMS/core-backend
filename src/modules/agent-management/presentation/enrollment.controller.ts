import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PublicRoute } from '@platform/http/api';
import { EnrollAgentUseCase } from '../application/enroll-agent.use-case';
import {
  AgentNodeNotEligibleError,
  BootstrapTokenConsumedError,
  BootstrapTokenExpiredError,
  BootstrapTokenInvalidError,
  EnrollmentAttemptConflictError,
  InstallationAlreadyBoundError,
  NodeAlreadyBoundError,
} from '../application/enrollment.port';

export const enrollmentRequestSchema = z
  .object({
    bootstrap_token: z.string().min(1),
    enrollment_attempt_id: z.uuid(),
    installation: z.object({ id: z.uuid() }).strict(),
    agent: z.object({ version: z.string().min(1).max(64) }).strict(),
    environment: z
      .object({
        os: z.enum(['linux', 'windows', 'darwin', 'other']),
        architecture: z.enum(['amd64', 'arm64', '386', 'other']),
        hostname: z.string().min(1).max(255).optional(),
      })
      .strict(),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .refine((metadata) => {
        if (metadata === undefined) return true;
        try {
          return (
            new TextEncoder().encode(JSON.stringify(metadata)).byteLength <=
            4096
          );
        } catch {
          return false;
        }
      }, 'Metadata must be JSON serializable and no larger than 4 KiB'),
  })
  .strict();

class EnrollmentRequestDto extends createZodDto(enrollmentRequestSchema) {}

@PublicRoute()
@Controller('agent-enrollments')
export class EnrollmentController {
  constructor(private readonly enrollAgent: EnrollAgentUseCase) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async enroll(
    @Body() body: EnrollmentRequestDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.enrollAgent.execute({
        bootstrapToken: body.bootstrap_token,
        attemptId: body.enrollment_attempt_id,
        installation: body.installation,
        agent: body.agent,
        environment: body.environment,
        metadata: body.metadata,
      });
      return {
        enrollment_id: result.enrollmentId,
        installation_id: result.installationId,
        binding: {
          id: result.binding.id,
          node_id: result.binding.nodeId,
          status: result.binding.status,
        },
        credential: { type: 'bearer', access_token: result.accessToken },
        control_plane: {
          base_url: result.controlPlane.baseUrl,
          poll_interval_seconds: result.controlPlane.pollIntervalSeconds,
        },
      };
    } catch (error) {
      if (error instanceof BootstrapTokenExpiredError) {
        throw new UnauthorizedException({ code: 'BOOTSTRAP_TOKEN_EXPIRED' });
      }
      if (error instanceof BootstrapTokenConsumedError) {
        throw new UnauthorizedException({ code: 'BOOTSTRAP_TOKEN_CONSUMED' });
      }
      if (error instanceof BootstrapTokenInvalidError) {
        throw new UnauthorizedException({ code: 'INVALID_BOOTSTRAP_TOKEN' });
      }
      if (error instanceof AgentNodeNotEligibleError) {
        throw new ConflictException({ code: 'NODE_NOT_ELIGIBLE' });
      }
      if (error instanceof NodeAlreadyBoundError) {
        throw new ConflictException({ code: 'NODE_ALREADY_BOUND' });
      }
      if (error instanceof InstallationAlreadyBoundError) {
        throw new ConflictException({ code: 'INSTALLATION_ALREADY_BOUND' });
      }
      if (error instanceof EnrollmentAttemptConflictError) {
        throw new ConflictException({ code: 'ENROLLMENT_ATTEMPT_CONFLICT' });
      }
      throw new ServiceUnavailableException({ code: 'ENROLLMENT_UNAVAILABLE' });
    }
  }
}

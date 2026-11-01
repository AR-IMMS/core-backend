import {
  applyDecorators,
  createParamDecorator,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { defineHttpRoutePolicy } from '@platform/http/api';
import type { AgentPrincipal } from '../application/agent-access.port';
import { AgentAuthenticationGuard } from './agent-authentication.guard';

/** Applies the Agent-only credential guard and its paired Human IAM bypass policy. */
export function AgentAuthenticated(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    defineHttpRoutePolicy({ kind: 'agent-authenticated' }),
    UseGuards(AgentAuthenticationGuard),
    ApiBearerAuth('agentBearer'),
  );
}

/** Reads the trusted Agent identity attached by AgentAuthenticationGuard. */
export const CurrentAgentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AgentPrincipal => {
    const request = context.switchToHttp().getRequest<{
      readonly agentPrincipal?: AgentPrincipal;
    }>();
    if (!request.agentPrincipal) throw new UnauthorizedException();
    return request.agentPrincipal;
  },
);

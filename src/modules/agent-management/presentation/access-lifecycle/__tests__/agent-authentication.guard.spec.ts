import { createHash } from 'node:crypto';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ServiceUnavailableException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api';
import type { AgentCredentialAuthorizationPort } from '../../../application/access-lifecycle/ports/agent-credential-authorization.port';
import { AgentAuthenticationGuard } from '../agent-authentication.guard';
import { AgentAuthenticated } from '../agent-authenticated.decorator';

describe('AgentAuthenticationGuard', () => {
  const principal = {
    installationId: 'installation-1',
    bindingId: 'binding-1',
    nodeId: 'node-1',
  };

  it('resolves the trusted principal from the hash of the opaque bearer', async () => {
    const findPrincipal = jest.fn().mockResolvedValue(principal);
    const access: AgentCredentialAuthorizationPort = {
      findActivePrincipalByCredentialHash: findPrincipal,
    };
    const guard = new AgentAuthenticationGuard(access);
    const request = {
      headers: { authorization: 'Bearer opaque-agent-secret' },
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);

    expect(findPrincipal).toHaveBeenCalledWith(
      createHash('sha256').update('opaque-agent-secret').digest('hex'),
    );
    expect(request).toHaveProperty('agentPrincipal', principal);
  });

  it.each([undefined, 'Basic opaque-agent-secret', 'Bearer two words'])(
    'rejects missing or malformed bearer header %s without querying storage',
    async (authorization) => {
      const findPrincipal = jest.fn();
      const access: AgentCredentialAuthorizationPort = {
        findActivePrincipalByCredentialHash: findPrincipal,
      };
      const guard = new AgentAuthenticationGuard(access);

      await expect(
        guard.canActivate(createContext({ headers: { authorization } })),
      ).rejects.toMatchObject({
        status: 401,
        response: { code: 'INVALID_AGENT_CREDENTIAL' },
      });
      expect(findPrincipal).not.toHaveBeenCalled();
    },
  );

  it('does not disclose whether a credential is unknown or revoked', async () => {
    const guard = new AgentAuthenticationGuard({
      findActivePrincipalByCredentialHash: jest.fn().mockResolvedValue(null),
    });

    await expect(
      guard.canActivate(
        createContext({ headers: { authorization: 'Bearer revoked-secret' } }),
      ),
    ).rejects.toMatchObject({
      status: 401,
      response: { code: 'INVALID_AGENT_CREDENTIAL' },
    });
  });

  it('maps persistence failures to a safe service error', async () => {
    const guard = new AgentAuthenticationGuard({
      findActivePrincipalByCredentialHash: jest
        .fn()
        .mockRejectedValue(new Error('credential secret leaked by driver')),
    });

    const error = await guard
      .canActivate(
        createContext({ headers: { authorization: 'Bearer valid-shape' } }),
      )
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify(error)).not.toContain(
      'credential secret leaked by driver',
    );
  });

  it('pairs the Human IAM bypass route policy with the Agent guard', () => {
    class AgentController {
      endpoint() {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      AgentController.prototype,
      'endpoint',
    );
    if (!descriptor) throw new Error('Test handler is missing');
    AgentAuthenticated()(AgentController.prototype, 'endpoint', descriptor);
    const handler: object = descriptor.value as object;

    expect(Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, handler)).toEqual({
      kind: 'agent-authenticated',
    });
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
      AgentAuthenticationGuard,
    );
  });
});

function createContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

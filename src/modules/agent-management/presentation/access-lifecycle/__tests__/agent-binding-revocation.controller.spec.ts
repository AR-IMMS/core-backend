import type { ArgumentMetadata } from '@nestjs/common';
import { CoreZodValidationPipe } from '@platform/http/validation/zod-validation.pipe';
import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api';
import { AgentBindingNotFoundError } from '../../../domain/errors/agent-binding.errors';
import { AgentBindingRevocationController } from '../agent-binding-revocation.controller';

describe('AgentBindingRevocationController', () => {
  const bindingId = 'e9a95012-1c46-4e85-97a0-a6b909b5c935';
  const principal = { userId: 'admin-1' };

  it('requires the human agent:manage permission', () => {
    const handler = getHandler(
      AgentBindingRevocationController.prototype,
      'revoke',
    );
    expect(Reflect.getMetadata(HTTP_ROUTE_POLICY_METADATA, handler)).toEqual({
      kind: 'permissions',
      permissions: ['agent:manage'],
    });
  });

  it('delegates the binding and verified human actor to the use case', async () => {
    const useCase = { execute: jest.fn().mockResolvedValue(undefined) };
    const controller = new AgentBindingRevocationController(useCase as never);

    await expect(
      controller.revoke({ bindingId }, principal as never),
    ).resolves.toBeUndefined();

    expect(useCase.execute).toHaveBeenCalledWith({
      bindingId,
      actorId: 'admin-1',
    });
  });

  it('rejects malformed binding IDs before invoking the use case', async () => {
    const [paramsMetatype] = Reflect.getMetadata(
      'design:paramtypes',
      AgentBindingRevocationController.prototype,
      'revoke',
    ) as unknown[];
    const pipe = new CoreZodValidationPipe();

    await expect(
      pipe.transform(
        { bindingId: 'bad-id' },
        {
          type: 'param',
          metatype: paramsMetatype as ArgumentMetadata['metatype'],
          data: undefined,
        },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('maps unknown bindings to the existing not-found ProblemDetails code', async () => {
    const controller = new AgentBindingRevocationController({
      execute: jest.fn().mockRejectedValue(new AgentBindingNotFoundError()),
    } as never);

    await expect(
      controller.revoke({ bindingId }, principal as never),
    ).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });
  });
});

function getHandler(target: object, propertyKey: string): object {
  const value: unknown = Object.getOwnPropertyDescriptor(
    target,
    propertyKey,
  )?.value;
  if (typeof value !== 'function') throw new Error('Test handler is missing');
  return value;
}

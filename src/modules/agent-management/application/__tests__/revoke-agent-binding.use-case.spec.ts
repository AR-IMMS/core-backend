import type { AuditFactV2 } from '@platform/events';

import { RevokeAgentBindingUseCase } from '../revoke-agent-binding.use-case';
import {
  AgentBindingNotFoundError,
  AgentBindingRevocationUnavailableError,
} from '../agent-access.port';
import type { AgentAccessPersistencePort } from '../agent-access.port';

describe('RevokeAgentBindingUseCase', () => {
  function harness(
    outcomes: Array<'revoked' | 'already-revoked' | 'not-found'>,
  ) {
    const facts: AuditFactV2[] = [];
    const revokeBinding = jest.fn().mockImplementation(() => {
      const outcome = outcomes.shift();
      if (!outcome) throw new Error('No revocation outcome configured');
      return Promise.resolve(outcome);
    });
    const persistence: AgentAccessPersistencePort = {
      findActivePrincipalByCredentialHash: jest.fn(),
      revokeBinding,
    };
    const unitOfWork = {
      run: jest.fn((operation: (context: object) => Promise<unknown>) =>
        operation({}),
      ),
    };
    const outbox = {
      append: jest.fn((fact: AuditFactV2) => {
        facts.push(fact);
        return Promise.resolve();
      }),
    };
    return {
      useCase: new RevokeAgentBindingUseCase(
        persistence,
        unitOfWork as never,
        outbox as never,
        () => new Date('2026-11-02T10:00:00.000Z'),
        () => 'event-1',
      ),
      persistence,
      revokeBinding,
      unitOfWork,
      outbox,
      facts,
    };
  }

  it('revokes once and appends a secret-free audit fact in the unit of work', async () => {
    const { useCase, revokeBinding, unitOfWork, outbox, facts } = harness([
      'revoked',
    ]);

    await useCase.execute({ bindingId: 'binding-1', actorId: 'admin-1' });

    expect(unitOfWork.run).toHaveBeenCalledTimes(1);
    expect(revokeBinding).toHaveBeenCalledWith(
      'binding-1',
      'admin-1',
      new Date('2026-11-02T10:00:00.000Z'),
      expect.anything(),
    );
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(facts[0])).not.toMatch(/token|credential|secret/i);
    expect(facts[0]?.payload.action).toBe(
      'agent_management.agent_binding.revoked',
    );
  });

  it('does not append another audit fact for an already revoked binding', async () => {
    const { useCase, outbox } = harness(['already-revoked']);

    await useCase.execute({ bindingId: 'binding-1', actorId: 'admin-1' });

    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('reports a missing binding without writing an audit fact', async () => {
    const { useCase, outbox } = harness(['not-found']);

    await expect(
      useCase.execute({ bindingId: 'missing', actorId: 'admin-1' }),
    ).rejects.toBeInstanceOf(AgentBindingNotFoundError);
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('maps transaction and outbox failures to a safe application error', async () => {
    const harnessResult = harness(['revoked']);
    jest
      .mocked(harnessResult.outbox.append)
      .mockRejectedValue(new Error('database detail with credential secret'));

    await expect(
      harnessResult.useCase.execute({
        bindingId: 'binding-1',
        actorId: 'admin-1',
      }),
    ).rejects.toBeInstanceOf(AgentBindingRevocationUnavailableError);
  });
});

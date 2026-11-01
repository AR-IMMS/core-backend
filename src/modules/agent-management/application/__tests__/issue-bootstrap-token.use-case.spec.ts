import { createHash } from 'node:crypto';
import {
  AgentNodeNotEligibleError,
  AgentNodeNotFoundError,
  IssueBootstrapTokenUseCase,
} from '../issue-bootstrap-token.use-case';
import { BootstrapTokenIssuanceConflictError } from '../../infrastructure/mongodb/mongo-bootstrap-token.store';

describe('IssueBootstrapTokenUseCase', () => {
  const secret = Buffer.from('01234567890123456789012345678901');
  const nodeId = 'a3cb4e2c-15c1-4c3d-8cc9-110a47ac7001';
  const eligible = { exists: true, active: true, hasActivePlacement: true };
  const harness = (eligibility = eligible, bound = false) => {
    const tokens = {
      hasActiveBinding: jest.fn().mockResolvedValue(bound),
      issue: jest.fn().mockResolvedValue(undefined),
    };
    const unitOfWork = {
      run: jest.fn(async (operation: (context: object) => Promise<unknown>) =>
        operation({}),
      ),
    };
    const outbox = { append: jest.fn().mockResolvedValue(undefined) };
    const useCase = new IssueBootstrapTokenUseCase(
      { getEligibility: jest.fn().mockResolvedValue(eligibility) },
      tokens,
      unitOfWork as never,
      outbox as never,
      () => new Date('2026-10-30T10:00:00.000Z'),
      () => secret,
      () => 'token-id',
    );
    return { useCase, tokens, outbox };
  };

  it('issues a 10-minute Node-bound token and persists only its SHA-256 hash', async () => {
    const { useCase, tokens, outbox } = harness();
    const result = await useCase.execute({ nodeId, createdBy: 'admin-id' });
    expect(result).toEqual({
      tokenId: 'bt_token-id',
      bootstrapToken: `arimms_bt_${secret.toString('base64url')}`,
      nodeId,
      expiresAt: new Date('2026-10-30T10:10:00.000Z'),
    });
    expect(tokens.issue).toHaveBeenCalledWith(
      {
        tokenId: 'bt_token-id',
        nodeId,
        tokenHash: createHash('sha256')
          .update(result.bootstrapToken)
          .digest('hex'),
        expiresAt: result.expiresAt,
        createdBy: 'admin-id',
      },
      expect.any(Object),
    );
    const auditCalls = JSON.stringify(outbox.append.mock.calls);
    expect(auditCalls).toContain('agent_management.bootstrap_token.issued');
    expect(auditCalls).not.toContain(result.bootstrapToken);
    expect(JSON.stringify(tokens.issue.mock.calls)).not.toContain(
      result.bootstrapToken,
    );
  });

  it('rejects an absent Node', async () => {
    const { useCase, tokens } = harness({
      exists: false,
      active: false,
      hasActivePlacement: false,
    });
    await expect(
      useCase.execute({ nodeId, createdBy: 'admin' }),
    ).rejects.toBeInstanceOf(AgentNodeNotFoundError);
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it.each([
    [{ exists: true, active: false, hasActivePlacement: true }, false],
    [{ exists: true, active: true, hasActivePlacement: false }, false],
    [eligible, true],
  ])('rejects ineligible Node state', async (eligibility, bound) => {
    const { useCase, tokens } = harness(eligibility, bound);
    await expect(
      useCase.execute({ nodeId, createdBy: 'admin' }),
    ).rejects.toBeInstanceOf(AgentNodeNotEligibleError);
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('allows only one of two concurrent issuances when persistence reports the unique-index race', async () => {
    let issuanceExists = false;
    const tokens = {
      hasActiveBinding: jest.fn().mockResolvedValue(false),
      issue: jest.fn().mockImplementation(() => {
        if (issuanceExists) throw new BootstrapTokenIssuanceConflictError();
        issuanceExists = true;
      }),
    };
    const useCase = new IssueBootstrapTokenUseCase(
      { getEligibility: jest.fn().mockResolvedValue(eligible) },
      tokens,
      {
        run: jest.fn(async (operation: (context: object) => Promise<unknown>) =>
          operation({}),
        ),
      } as never,
      { append: jest.fn().mockResolvedValue(undefined) } as never,
      () => new Date('2026-10-30T10:00:00.000Z'),
      () => secret,
      () => 'token-id',
    );

    const results = await Promise.allSettled([
      useCase.execute({ nodeId, createdBy: 'admin-1' }),
      useCase.execute({ nodeId, createdBy: 'admin-2' }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });
});

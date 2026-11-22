import { Test } from '@nestjs/testing';
import { AGENT_NODE_LIFECYCLE_COORDINATION_PORT } from '@modules/agent-management/contracts';
import { UNIT_OF_WORK_PORT } from '@platform/events';
import { NODE_LIFECYCLE_OPERATION_PORT } from '../node-lifecycle-operation.port';
import { NodeLifecycleOrchestrator } from '../node-lifecycle-orchestrator';

describe('NodeLifecycleOrchestrator dependency injection', () => {
  it('uses its default clock and ID factory without Nest providers', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NodeLifecycleOrchestrator,
        { provide: NODE_LIFECYCLE_OPERATION_PORT, useValue: {} },
        { provide: AGENT_NODE_LIFECYCLE_COORDINATION_PORT, useValue: {} },
        { provide: UNIT_OF_WORK_PORT, useValue: {} },
      ],
    }).compile();

    expect(moduleRef.get(NodeLifecycleOrchestrator)).toBeInstanceOf(
      NodeLifecycleOrchestrator,
    );
    await moduleRef.close();
  });
});

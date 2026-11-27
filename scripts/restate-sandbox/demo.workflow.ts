import * as restate from '@restatedev/restate-sdk';

interface DemoInput {
  readonly name: string;
}

type DemoStatus = 'STARTED' | 'WAITING_CONFIRMATION' | 'COMPLETED';

/**
 * Demonstrates durable execution, state, and external signals.
 */
export const demoWorkflow = restate.workflow({
  name: 'DemoWorkflow',

  handlers: {
    run: async (ctx: restate.WorkflowContext, input: DemoInput) => {
      ctx.set<DemoStatus>('status', 'STARTED');

      const preparedAt = await ctx.run('prepare', () => {
        const timestamp = new Date().toISOString();

        console.log('[STEP] Preparing workflow:', timestamp);

        return timestamp;
      });

      ctx.set<DemoStatus>('status', 'WAITING_CONFIRMATION');

      const confirmed = await ctx.promise<boolean>('confirmation');

      ctx.set<DemoStatus>('status', 'COMPLETED');

      return {
        name: input.name,
        confirmed,
        preparedAt,
      };
    },

    confirm: async (
      ctx: restate.WorkflowSharedContext,
      confirmed: boolean,
    ): Promise<void> => {
      await ctx.promise<boolean>('confirmation').resolve(confirmed);
    },

    getStatus: async (
      ctx: restate.WorkflowSharedContext,
    ): Promise<DemoStatus | 'NOT_STARTED'> => {
      return (await ctx.get<DemoStatus>('status')) ?? 'NOT_STARTED';
    },
  },
});

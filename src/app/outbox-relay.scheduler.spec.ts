import { Logger } from '@nestjs/common';
import { OutboxRelayService } from '@platform/events';
import type { OutboxRelayRunResult } from '@platform/events';

import { OutboxRelayScheduler } from './outbox-relay.scheduler';

const EMPTY_RUN_RESULT: OutboxRelayRunResult = {
  claimed: 0,
  delivered: 0,
  failed: 0,
};

describe('OutboxRelayScheduler', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /** It processes a pass on bootstrap, repeats on the host cadence, and stops on shutdown. */
  test('runs immediately, polls repeatedly, and stops after shutdown', async () => {
    const relay = createRelay();
    const scheduler = new OutboxRelayScheduler(
      relay as unknown as OutboxRelayService,
    );

    scheduler.onApplicationBootstrap();
    expect(relay.runOnce).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2_000);
    expect(relay.runOnce).toHaveBeenCalledTimes(3);

    await scheduler.onApplicationShutdown();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(relay.runOnce).toHaveBeenCalledTimes(3);
  });

  /** It skips timer ticks while a previous pass is still processing. */
  test('does not overlap relay passes', async () => {
    let finishFirstPass: (result: OutboxRelayRunResult) => void = () =>
      undefined;
    const firstPass = new Promise<OutboxRelayRunResult>((resolve) => {
      finishFirstPass = resolve;
    });
    const relay = createRelay();
    relay.runOnce.mockReturnValueOnce(firstPass);
    const scheduler = new OutboxRelayScheduler(
      relay as unknown as OutboxRelayService,
    );

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(3_000);
    expect(relay.runOnce).toHaveBeenCalledTimes(1);

    finishFirstPass(EMPTY_RUN_RESULT);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(relay.runOnce).toHaveBeenCalledTimes(2);
    await scheduler.onApplicationShutdown();
  });

  /** It logs a failed infrastructure pass without stopping future relay attempts. */
  test('continues polling after a relay pass throws', async () => {
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const relay = createRelay();
    relay.runOnce
      .mockRejectedValueOnce(new Error('Mongo unavailable'))
      .mockResolvedValue(EMPTY_RUN_RESULT);
    const scheduler = new OutboxRelayScheduler(
      relay as unknown as OutboxRelayService,
    );

    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(1_000);

    expect(loggerError).toHaveBeenCalledWith(
      'Outbox relay pass failed: Mongo unavailable',
      expect.any(String),
    );
    expect(relay.runOnce).toHaveBeenCalledTimes(2);
    await scheduler.onApplicationShutdown();
  });
});

function createRelay() {
  return {
    runOnce: jest
      .fn<() => Promise<OutboxRelayRunResult>>()
      .mockResolvedValue({ ...EMPTY_RUN_RESULT }),
  };
}

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { OutboxRelayService } from '@platform/events';

/** Polls the existing platform relay from the Core application lifecycle. */
@Injectable()
export class OutboxRelayScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private static readonly intervalMs = 1_000;
  private readonly logger = new Logger(OutboxRelayScheduler.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(private readonly relay: OutboxRelayService) {}

  onApplicationBootstrap(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.runOnce();
    }, OutboxRelayScheduler.intervalMs);
    void this.runOnce();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private runOnce(): Promise<void> {
    if (this.inFlight) return this.inFlight;

    const run = this.runSafely();
    this.inFlight = run;
    void run.then(() => {
      if (this.inFlight === run) this.inFlight = undefined;
    });
    return run;
  }

  private async runSafely(): Promise<void> {
    try {
      const result = await this.relay.runOnce();
      if (result.failed > 0) {
        this.logger.warn(
          `Outbox relay pass completed with ${result.failed} failed delivery attempt(s)`,
        );
      } else if (result.claimed > 0) {
        this.logger.log(
          `Outbox relay delivered ${result.delivered} of ${result.claimed} claimed fact(s)`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Outbox relay pass failed: ${message}`, stack);
    }
  }
}

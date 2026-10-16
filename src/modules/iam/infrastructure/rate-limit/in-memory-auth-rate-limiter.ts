import type { AuthRateLimiterPort } from '../../application/ports/auth-rate-limiter.port';

interface WindowCounter {
  count: number;
  expiresAt: number;
}

/** PoC rate limiter; replace its storage adapter if shared distributed limits are required. */
export class InMemoryAuthRateLimiter implements AuthRateLimiterPort {
  private readonly counters = new Map<string, WindowCounter>();
  private operations = 0;

  constructor(private readonly now: () => number = Date.now) {}

  consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{
    readonly allowed: boolean;
    readonly retryAfterSeconds: number;
  }> {
    const now = this.now();
    if (++this.operations % 256 === 0) this.removeExpired(now);
    if (!this.counters.has(key) && this.counters.size >= 10_000) {
      this.removeExpired(now);
    }
    const current = this.counters.get(key);
    const counter =
      !current || current.expiresAt <= now
        ? { count: 0, expiresAt: now + windowSeconds * 1000 }
        : current;
    counter.count += 1;
    this.counters.set(key, counter);

    return Promise.resolve({
      allowed: counter.count <= limit,
      retryAfterSeconds: Math.max(
        0,
        Math.ceil((counter.expiresAt - now) / 1000),
      ),
    });
  }

  private removeExpired(now: number): void {
    for (const [key, counter] of this.counters) {
      if (counter.expiresAt <= now) this.counters.delete(key);
    }
    while (this.counters.size >= 10_000) {
      const oldestKey = this.counters.keys().next().value;
      if (oldestKey === undefined) return;
      this.counters.delete(oldestKey);
    }
  }
}

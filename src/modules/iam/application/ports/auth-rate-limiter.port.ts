/** Application-facing rate limiter used by public IAM authentication flows. */
export interface AuthRateLimiterPort {
  consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ readonly allowed: boolean; readonly retryAfterSeconds: number }>;
}

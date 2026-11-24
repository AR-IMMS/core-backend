export interface EnrollmentInput {
  readonly bootstrapToken: string;
  readonly attemptId: string;
  readonly installation: { readonly id: string };
  readonly agent: { readonly version: string };
  readonly environment: {
    readonly os: string;
    readonly architecture: string;
    readonly hostname?: string;
  };
  readonly metadata?: Record<string, unknown>;
}

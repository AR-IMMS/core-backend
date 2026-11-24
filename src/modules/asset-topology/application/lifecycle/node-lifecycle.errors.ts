export class NodeLifecycleConflictError extends Error {
  readonly code = 'NODE_LIFECYCLE_OPERATION_PENDING';
  constructor(readonly operationId: string) {
    super('A Node lifecycle operation is already pending');
    this.name = 'NodeLifecycleConflictError';
  }
}
export class NodeLifecycleIdempotencyConflictError extends Error {
  readonly code = 'NODE_LIFECYCLE_IDEMPOTENCY_CONFLICT';
  constructor() {
    super('Idempotency key was already used for a different request');
    this.name = 'NodeLifecycleIdempotencyConflictError';
  }
}
export class NodeLifecycleOperationNotFoundError extends Error {
  constructor() {
    super('Node lifecycle operation was not found');
    this.name = 'NodeLifecycleOperationNotFoundError';
  }
}
export class NodeLifecycleOperationUnavailableError extends Error {
  readonly code = 'NODE_LIFECYCLE_OPERATION_UNAVAILABLE';
  constructor() {
    super('Node lifecycle operation state is temporarily unavailable');
    this.name = 'NodeLifecycleOperationUnavailableError';
  }
}

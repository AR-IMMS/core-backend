export class FleetOperationPendingError extends Error {
  constructor(
    readonly operationId: string,
    readonly stage: string,
  ) {
    super('Fleet operation is awaiting retry');
    this.name = 'FleetOperationPendingError';
  }
}

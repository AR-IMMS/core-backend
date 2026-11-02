export class BootstrapTokenIssuanceConflictError extends Error {
  constructor() {
    super('Bootstrap token issuance conflicts with a concurrent operation');
    this.name = 'BootstrapTokenIssuanceConflictError';
  }
}

export class FleetUnavailableError extends Error {
  constructor(readonly outcomeUnknown: boolean) {
    super('Fleet service is temporarily unavailable');
    this.name = 'FleetUnavailableError';
  }
}

export class FleetConflictError extends Error {
  constructor(readonly code: string) {
    super('Fleet rejected the operation due to a conflict');
    this.name = 'FleetConflictError';
  }
}

export class FleetNotFoundError extends Error {
  constructor() {
    super('Fleet resource was not found');
    this.name = 'FleetNotFoundError';
  }
}

export class FleetProtocolError extends Error {
  constructor() {
    super('Fleet returned an invalid response');
    this.name = 'FleetProtocolError';
  }
}

export class QrMappingConflictError extends Error {
  constructor() {
    super(
      'The generated QR value or active target mapping conflicts with existing history',
    );
    this.name = 'QrMappingConflictError';
  }
}

export function isQrDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

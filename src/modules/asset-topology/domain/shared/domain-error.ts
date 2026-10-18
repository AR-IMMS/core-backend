/**
 * A business-rule failure raised by the Asset & Topology domain.
 *
 * The code is stable for application and presentation layers to map to their
 * own error contracts; the domain itself remains independent of HTTP/NestJS.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

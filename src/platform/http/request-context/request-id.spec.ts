import { getRequestId } from './request-id';

describe('request ID generation', () => {
  /** It reuses the ID that Pino assigned before request context middleware ran. */
  it('reuses an existing request ID', () => {
    expect(getRequestId({ id: 'request-123' })).toBe('request-123');
  });

  /** It creates a UUID when the request has no ID from earlier middleware. */
  it('generates a UUID when no request ID exists', () => {
    expect(getRequestId({})).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

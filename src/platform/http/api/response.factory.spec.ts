import { describe, expect, it } from '@jest/globals';

import { createListResponse, createSingleResponse } from '@platform/http/api';

describe('API response factories', () => {
  const meta = { request_id: 'req_123' };

  it('creates a single-resource response envelope', () => {
    expect(createSingleResponse({ id: 'asset_123' }, meta)).toEqual({
      data: { id: 'asset_123' },
      meta,
    });
  });

  it('adds pagination to a list response when provided', () => {
    expect(
      createListResponse([{ id: 'event_123' }], meta, {
        type: 'cursor',
        next_cursor: null,
      }),
    ).toEqual({
      data: [{ id: 'event_123' }],
      meta,
      pagination: { type: 'cursor', next_cursor: null },
    });
  });
});

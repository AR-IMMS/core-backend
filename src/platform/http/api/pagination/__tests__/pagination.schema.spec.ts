import { describe, expect, it } from '@jest/globals';

import {
  cursorPaginationQuerySchema,
  pagePaginationQuerySchema,
} from '@platform/http/api/pagination';

describe('cursorPaginationQuerySchema', () => {
  it('defaults page_size and accepts an opaque cursor', () => {
    expect(cursorPaginationQuerySchema.parse({ cursor: 'cursor_123' })).toEqual(
      {
        page_size: 20,
        cursor: 'cursor_123',
      },
    );
  });

  it('rejects a page size above the shared maximum', () => {
    expect(() =>
      cursorPaginationQuerySchema.parse({ page_size: 101 }),
    ).toThrow();
  });

  it('rejects a blank cursor', () => {
    expect(() =>
      cursorPaginationQuerySchema.parse({ cursor: '   ' }),
    ).toThrow();
  });
});

describe('pagePaginationQuerySchema', () => {
  it('defaults page and page_size', () => {
    expect(pagePaginationQuerySchema.parse({})).toEqual({
      page: 1,
      page_size: 20,
    });
  });

  it('coerces numeric query values', () => {
    expect(
      pagePaginationQuerySchema.parse({ page: '2', page_size: '10' }),
    ).toEqual({
      page: 2,
      page_size: 10,
    });
  });
});

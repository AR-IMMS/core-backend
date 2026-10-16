/** Cursor pagination metadata; cursors remain opaque to the HTTP module. */
export interface CursorPagination {
  type: 'cursor';
  next_cursor: string | null;
}

/** Page-based pagination metadata returned alongside list data. */
export interface PagePagination {
  type: 'page';
  page: number;
  page_size: number;
  total_items?: number | null;
  total_pages?: number | null;
  has_next: boolean;
  has_prev: boolean;
}

/** Supported pagination metadata shapes. */
export type Pagination = CursorPagination | PagePagination;

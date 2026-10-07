export interface CursorPagination {
  type: 'cursor';
  next_cursor: string | null;
}

export interface PagePagination {
  type: 'page';
  page: number;
  page_size: number;
  total_items?: number | null;
  total_pages?: number | null;
  has_next: boolean;
  has_prev: boolean;
}

export type Pagination = CursorPagination | PagePagination;

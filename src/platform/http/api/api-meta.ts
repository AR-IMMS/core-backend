export interface ApiMeta {
  request_id: string;
  trace_id?: string;
}

export function createApiMeta(requestId: string, traceId?: string): ApiMeta {
  return {
    request_id: requestId,
    ...(traceId ? { trace_id: traceId } : {}),
  };
}

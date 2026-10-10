import { RATE_LIMIT_MESSAGE } from '@/utils/rateLimit';

export function caughtApiError(error: unknown): { status: number; message: string; code: string; retryAfterSeconds?: number } {
  const failure = errorDetails(error);
  const statusByCode: Record<string, number> = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    TOO_MANY_REQUESTS: 429,
  };
  return {
    status: (failure.code && statusByCode[failure.code]) || 500,
    message: failure.message,
    code: failure.code || 'INTERNAL_ERROR',
    retryAfterSeconds: failure.retryAfterSeconds,
  };
}

function errorDetails(error: unknown): { message: string; code?: string; retryAfterSeconds?: number } {
  const record = error && typeof error === 'object'
    ? error as { message?: unknown; code?: unknown; retryAfterSeconds?: unknown }
    : undefined;
  const code = typeof record?.code === 'string' ? record.code : undefined;
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === 'string' && record.message.trim()
      ? record.message
      : 'Internal Server Error';
  const retryAfterSeconds = typeof record?.retryAfterSeconds === 'number' && record.retryAfterSeconds > 0
    ? Math.ceil(record.retryAfterSeconds)
    : undefined;
  if (code === 'TOO_MANY_REQUESTS' || /rate limit exceeded|too many requests/i.test(message)) {
    return { message: RATE_LIMIT_MESSAGE, code: 'TOO_MANY_REQUESTS', retryAfterSeconds };
  }
  return { message, code };
}

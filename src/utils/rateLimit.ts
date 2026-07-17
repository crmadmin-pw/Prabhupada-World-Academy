// Simple in-memory rate limiter for backend endpoints
// ISSUE-005 FIX: Prevents bulk PII extraction via rapid repeated calls

const rateLimitStore = new Map<string, { count: number; windowStart: number }>();

/**
 * Enforces a per-key rate limit. Throws if the caller exceeds the allowed number of calls
 * within the rolling time window.
 *
 * @param key      Unique identifier for the caller (e.g. user email)
 * @param maxCalls Maximum allowed calls within the window
 * @param windowMs Rolling window duration in milliseconds
 */
export function enforceRateLimit(key: string, maxCalls: number, windowMs: number): void {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    // Start a new window
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return;
  }

  entry.count += 1;
  if (entry.count > maxCalls) {
    throw new Error(`Rate limit exceeded — please wait before retrying`);
  }
}

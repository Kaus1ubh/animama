/**
 * Seconds until an HTTP `Retry-After` value (delta-seconds or an HTTP date),
 * or null when it is absent, unreadable or already past.
 */
export function retryAfterSeconds(
  value: string | null | undefined,
  now = Date.now(),
): number | null {
  const text = value?.trim();
  if (!text) return null;
  const seconds = /^\d+$/.test(text)
    ? Number(text)
    : (Date.parse(text) - now) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

/**
 * Carry a response's `Retry-After` delay into its parsed JSON error body as
 * `retry_after_seconds` (the hosted denial field) unless the body states one,
 * so chat failure copy can name the wait. Other bodies are returned unchanged.
 */
export function withRetryAfter(
  body: unknown,
  headers: Headers | undefined,
): unknown {
  const delay = retryAfterSeconds(headers?.get("Retry-After"));
  if (
    delay === null ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    "retry_after_seconds" in body
  )
    return body;
  return { ...body, retry_after_seconds: delay };
}

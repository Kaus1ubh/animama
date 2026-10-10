/**
 * A server-provided URL that is safe to open, as its normalized `href`, or
 * null: absolute `https:` without embedded credentials. Given the application
 * `origin` (for example `https://app.example`), a path resolves against it and
 * that origin's own `http:` URLs (local HTTP) are accepted as well.
 */
export function safeNavigationUrl(
  value: unknown,
  origin?: string,
): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.href;
  // Plain HTTP only for the application's own origin (local runtimes).
  return url.protocol === "http:" && url.origin === origin ? url.href : null;
}

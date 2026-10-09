const SIGN_OUT_INCOMPLETE_KEY = "animama.hosted-sign-out-incomplete.v1";
const SIGN_IN_PARAM = "sign_in";
const GENERATION_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/**
 * A failed remote logout, recorded browser-wide: the Cloud session it targeted
 * is still live, so every tab and reload keeps the sign-out retry view instead
 * of readmitting it. `generation` is that session's noncredential recovery
 * generation when it was known, so a newer session is never held to the
 * record. It holds no account data or credential.
 */
export type IncompleteSignOut = { readonly generation: string | null };

/** A valid recovery generation, or null. */
export function recoveryGeneration(value: unknown): string | null {
  return typeof value === "string" && GENERATION_PATTERN.test(value)
    ? value
    : null;
}

/** The recorded failed sign-out, null without one, or undefined when storage is unavailable. */
export function readIncompleteSignOut(): IncompleteSignOut | null | undefined {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SIGN_OUT_INCOMPLETE_KEY);
  } catch {
    return undefined;
  }
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { generation?: unknown } | null;
    return { generation: recoveryGeneration(value?.generation) };
  } catch {
    // An unreadable record still guards whichever session is live.
    return { generation: null };
  }
}

/** Records, or with null clears, a failed sign-out; false when storage is unavailable. */
export function writeIncompleteSignOut(
  record: IncompleteSignOut | null,
): boolean {
  try {
    if (record)
      window.localStorage.setItem(
        SIGN_OUT_INCOMPLETE_KEY,
        JSON.stringify(record),
      );
    else window.localStorage.removeItem(SIGN_OUT_INCOMPLETE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * The app path to return to after sign-in: the current path and query without
 * the callback marker. It mirrors the server's check, which stays authoritative.
 */
export function signInReturnPath(): string {
  if (typeof window === "undefined" || !window.location) return "/";
  const params = new URLSearchParams(window.location.search);
  params.delete(SIGN_IN_PARAM);
  const query = params.toString();
  const path = `${window.location.pathname}${query ? `?${query}` : ""}`;
  return path.startsWith("/") &&
    !path.startsWith("//") &&
    path.length <= 512 &&
    !/[\\\r\n\t]/.test(path) &&
    !/^\/(?:api|internal)\//.test(path)
    ? path
    : "/";
}

/**
 * A failed sign-in callback returns with `?sign_in=failed`. Remove the marker
 * before the router reads the URL, so a reload does not repeat the notice, and
 * report whether it was present.
 */
export function takeSignInFailure(): boolean {
  if (typeof window === "undefined" || !window.location) return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get(SIGN_IN_PARAM) !== "failed") return false;
  url.searchParams.delete(SIGN_IN_PARAM);
  window.history?.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
  return true;
}

const SIGN_OUT_INCOMPLETE_KEY = "animama.hosted-sign-out-incomplete.v1";
const SIGN_IN_PARAM = "sign_in";

/**
 * A failed remote logout leaves the Cloud session live. This browser-wide
 * marker keeps every tab, and a reload, on the sign-out retry view until a
 * sign-out finishes or someone signs in again. It holds no account data.
 */
export function signOutMarkedIncomplete(): boolean {
  try {
    return window.localStorage.getItem(SIGN_OUT_INCOMPLETE_KEY) !== null;
  } catch {
    return false;
  }
}

export function markSignOutIncomplete(incomplete: boolean): void {
  try {
    if (incomplete) window.localStorage.setItem(SIGN_OUT_INCOMPLETE_KEY, "1");
    else window.localStorage.removeItem(SIGN_OUT_INCOMPLETE_KEY);
  } catch {
    /* Without storage, the current page still keeps its own state. */
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

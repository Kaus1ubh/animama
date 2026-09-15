const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

let installed = false;

/**
 * Install the one browser-wide local gateway interceptor.
 * It adds only the CSRF marker to same-origin state-changing `/v1` requests;
 * identity resolution remains server-owned after request admission.
 */
export function installLocalGatewayFetchInterceptor(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith("/v1") ||
      !MUTATING_METHODS.has(request.method.toUpperCase())
    ) {
      return nativeFetch(request);
    }

    const headers = new Headers(request.headers);
    headers.set("X-Animama-CSRF", "1");
    return nativeFetch(new Request(request, { headers }));
  };
}

/** Preserve the configured upstream authority for every untrusted request path. */
export function buildUpstreamUrl(requestUrl: URL, upstreamOrigin: URL): URL {
  const target = new URL(upstreamOrigin);
  target.pathname = requestUrl.pathname;
  target.search = requestUrl.search;
  return target;
}

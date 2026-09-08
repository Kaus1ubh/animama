import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "baggage",
  "cache-control",
  "content-encoding",
  "content-length",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "last-event-id",
  "range",
  "traceparent",
  "tracestate",
  "user-agent",
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "vary",
  "x-content-type-options",
]);

const WEBSOCKET_REQUEST_HEADER_ALLOWLIST = new Set([
  "origin",
  "sec-fetch-site",
  "sec-websocket-extensions",
  "sec-websocket-key",
  "sec-websocket-protocol",
  "sec-websocket-version",
  "user-agent",
]);

const WEBSOCKET_RESPONSE_HEADER_ALLOWLIST = new Set([
  "connection",
  "sec-websocket-accept",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
  "upgrade",
]);

export type TrustedGatewayAssertion = {
  principalId: string;
  internalToken: string;
};

/** Copy only request metadata FastAPI needs, then overwrite trusted assertions. */
export function buildHttpUpstreamHeaders(
  request: Request,
  assertion?: TrustedGatewayAssertion,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of request.headers) {
    const normalized = name.toLowerCase();
    if (REQUEST_HEADER_ALLOWLIST.has(normalized)) {
      headers[normalized] = value;
    }
  }
  if (assertion) {
    headers["x-animama-principal-id"] = assertion.principalId;
    headers["x-animama-internal-token"] = assertion.internalToken;
  }
  return headers;
}

/** Preserve bounded download, range, cache, JSON, and SSE response metadata. */
export function buildHttpResponseHeaders(upstream: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (
      !RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase()) ||
      value === undefined
    ) {
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

export function buildWebSocketUpstreamHeaders(
  incoming: IncomingHttpHeaders,
  assertion?: TrustedGatewayAssertion,
): Record<string, string> {
  const headers: Record<string, string> = {
    connection: "Upgrade",
    upgrade: "websocket",
  };
  for (const [name, value] of Object.entries(incoming)) {
    if (
      !WEBSOCKET_REQUEST_HEADER_ALLOWLIST.has(name.toLowerCase()) ||
      value === undefined
    ) {
      continue;
    }
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  if (assertion) {
    headers["x-animama-principal-id"] = assertion.principalId;
    headers["x-animama-internal-token"] = assertion.internalToken;
  }
  return headers;
}

export function serializeWebSocketResponseHeaders(
  upstream: IncomingMessage,
): string {
  const lines = ["HTTP/1.1 101 Switching Protocols"];
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (
      !WEBSOCKET_RESPONSE_HEADER_ALLOWLIST.has(name.toLowerCase()) ||
      value === undefined
    ) {
      continue;
    }
    const rendered = Array.isArray(value) ? value.join(", ") : value;
    lines.push(`${name}: ${rendered}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

import type { Context } from "hono";

import { normalizeBaseUrl, readBooleanEnv } from "./utils.js";

const VALID_SIGNALS = new Set(["traces", "metrics", "logs"]);

function resolveOtlpEndpoint(signal: string): string {
  const upper = signal.toUpperCase();
  const direct = process.env[`OTEL_EXPORTER_OTLP_${upper}_ENDPOINT`];
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const fallback = "http://otel-collector:4318";
  const normalized = normalizeBaseUrl(direct || base || fallback);
  if (normalized.endsWith(`/v1/${signal}`)) {
    return normalized;
  }
  return `${normalized}/v1/${signal}`;
}

function buildForwardHeaders(req: Request): Headers {
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  const contentEncoding = req.headers.get("content-encoding");
  if (contentType) headers.set("content-type", contentType);
  if (contentEncoding) headers.set("content-encoding", contentEncoding);
  return headers;
}

function isTelemetryDisabled(): boolean {
  return readBooleanEnv(
    "FRONTEND_SERVER_DISABLE_WEBUI_TELEMETRY",
    "ANIMAMA_DISABLE_WEBUI_TELEMETRY",
    "NEXT_PUBLIC_ANIMAMA_DISABLE_WEBUI_TELEMETRY",
  );
}

function isTracingDisabled(): boolean {
  return (
    isTelemetryDisabled() ||
    readBooleanEnv(
      "FRONTEND_SERVER_DISABLE_WEBUI_TRACES",
      "ANIMAMA_DISABLE_WEBUI_TRACES",
      "NEXT_PUBLIC_ANIMAMA_DISABLE_WEBUI_TRACES",
    )
  );
}

export async function proxyTelemetry(c: Context): Promise<Response> {
  if (isTelemetryDisabled()) {
    return new Response(null, { status: 204 });
  }

  const signal = (c.req.param("signal") || "").toLowerCase();
  if (signal === "traces" && isTracingDisabled()) {
    return new Response(null, { status: 204 });
  }
  if (!VALID_SIGNALS.has(signal)) {
    return c.json({ error: "invalid_signal" }, 404);
  }

  let body: ArrayBuffer;
  try {
    body = await c.req.raw.arrayBuffer();
  } catch {
    return c.json({ error: "invalid_body" }, 400);
  }

  const endpoint = resolveOtlpEndpoint(signal);
  const forwardHeaders = buildForwardHeaders(c.req.raw);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: forwardHeaders,
      body,
    });
    const responseBody = await response.arrayBuffer();
    const responseHeaders = new Headers();
    const responseContentType = response.headers.get("content-type");
    if (responseContentType) {
      responseHeaders.set("content-type", responseContentType);
    }
    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return c.json({ error: "upstream_unavailable" }, 502);
  }
}

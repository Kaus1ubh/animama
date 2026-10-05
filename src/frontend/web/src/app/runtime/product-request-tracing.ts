import { context, propagation } from "@opentelemetry/api";
import { isWebUiTracingDisabled } from "@/lib/telemetry/enabled";

const setter = {
  set: (headers: Headers, key: string, value: string) =>
    headers.set(key, value),
};

/** Preserve product request tracing without mutating the generated SDK's default client. */
export function traceProductRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  if (!isWebUiTracingDisabled() && !headers.has("traceparent"))
    propagation.inject(context.active(), headers, setter);
  return new Request(request, { headers });
}

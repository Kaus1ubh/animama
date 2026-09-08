"use client";

import { context, propagation } from "@opentelemetry/api";

import { client } from "@animama/runtime-contracts/default-client";
import { isWebUiTracingDisabled } from "@/lib/telemetry/enabled";

let configured = false;

const otelHeaderSetter = {
  set(carrier: Headers, key: string, value: string) {
    carrier.set(key, value);
  },
};

/** Configure the generated client against the same-origin local gateway. */
export function configureAnimaApiClient(): void {
  if (configured) return;
  configured = true;

  if (typeof window !== "undefined") {
    client.setConfig({ baseUrl: window.location.origin });
  }
  client.interceptors.request.use(async (request) => {
    const headers = new Headers(request.headers);

    if (!isWebUiTracingDisabled() && !headers.has("traceparent")) {
      propagation.inject(context.active(), headers, otelHeaderSetter);
    }

    return new Request(request, { headers });
  });
}

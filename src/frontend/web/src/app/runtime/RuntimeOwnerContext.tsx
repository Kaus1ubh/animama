"use client";
import { useMemo, type ReactNode } from "react";
import { context, propagation } from "@opentelemetry/api";
import {
  ProductRuntimeProvider,
  type ProductDiagnostics,
} from "@animama/product-ui";
import type {
  ProductApiTransport,
  ProductRuntimeCapabilities,
} from "@animama/runtime-contracts";
import { createLogger } from "@/lib/logger";
import { isWebUiTracingDisabled } from "@/lib/telemetry/enabled";
import * as metrics from "@/lib/telemetry/metrics";
import "@animama/product-ui/styles.css";
export {
  useRuntimeOwnerId,
  useRuntimeCacheKey,
  useProductApiClient,
} from "@animama/product-ui";

// Chat turns run in shared product code; the host marks their start and end as
// diagnostics milestones from the same SSE metric hooks.
const chatLogger = createLogger("Chat");
const diagnostics: ProductDiagnostics = {
  createLogger,
  ...metrics,
  recordSseStart: (attributes) => {
    chatLogger.milestone("Turn", "Chat turn started");
    metrics.recordSseStart(attributes);
  },
  recordSseDuration: (durationMs, attributes) => {
    const status =
      typeof attributes.status === "string" ? attributes.status : "unknown";
    chatLogger.milestone(
      "Turn",
      `Chat turn ended (${status}, ${(durationMs / 1000).toFixed(1)} s)`,
    );
    metrics.recordSseDuration(durationMs, attributes);
  },
};
const localCapabilities = { chat: true } as const;
const localFetch: typeof globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);
  if (!isWebUiTracingDisabled() && !headers.has("traceparent")) {
    propagation.inject(context.active(), headers, {
      set: (carrier, key, value) => carrier.set(key, value),
    });
  }
  return globalThis.fetch(new Request(request, { headers }));
};

/** Local readiness supplies an owner; the shared package owns no installation policy. */
export function RuntimeOwnerProvider({
  ownerId,
  sessionKey = ownerId,
  transport: suppliedTransport,
  capabilities = localCapabilities,
  children,
}: {
  ownerId: string;
  sessionKey?: string;
  transport?: ProductApiTransport;
  capabilities?: ProductRuntimeCapabilities;
  children: ReactNode;
}) {
  const owner = useMemo(() => ({ id: ownerId }), [ownerId]);
  const transport = useMemo(
    () => ({
      baseUrl:
        typeof window === "undefined"
          ? "http://localhost"
          : window.location.origin,
      fetch: localFetch,
    }),
    [],
  );
  return (
    <ProductRuntimeProvider
      owner={owner}
      capabilities={capabilities}
      transport={suppliedTransport ?? transport}
      sessionKey={sessionKey}
      diagnostics={diagnostics}
    >
      {children}
    </ProductRuntimeProvider>
  );
}

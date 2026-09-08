/** Opaque product-data owner supplied by the current application composition. */
export interface RuntimeOwner {
  readonly id: string;
  readonly displayName?: string;
}

/** Product capabilities used by the extracted Anima/chat surface. */
export interface ProductRuntimeCapabilities {
  readonly chat: boolean;
}

/** Public readiness summary; service-specific lifecycle authority stays outside UI. */
export interface RuntimeLifecycleSummary {
  readonly status: "ready" | "unavailable";
  readonly message?: string;
}

/** Explicit HTTP boundary; each product provider receives its own transport. */
export interface ProductApiTransport {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
}

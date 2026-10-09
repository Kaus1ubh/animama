import type { RuntimeCapabilities } from "./generated/types.gen";

export type { RuntimeCapabilities } from "./generated/types.gen";

/** Opaque product-data owner supplied by the current application composition. */
export interface RuntimeOwner {
  readonly id: string;
  readonly displayName?: string;
}

/** Compatibility view for the extracted chat surface, derived from the HTTP schema. */
export type ProductRuntimeCapabilities = Readonly<
  Pick<RuntimeCapabilities, "chat">
>;

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

/** A browser resource lifetime; this opaque key is never a credential or HTTP owner selector. */
export interface RuntimeSession {
  readonly key: string;
  readonly owner: RuntimeOwner;
}

/** Only admitted state carries an owner, capabilities and a session lifetime. */
export type RuntimeAdmission =
  | {
      readonly status: "ready";
      readonly session: RuntimeSession;
      readonly capabilities: RuntimeCapabilities;
      readonly onboardingRequired: boolean;
    }
  | {
      readonly status:
        | "loading"
        | "sign-in-required"
        | "ineligible"
        | "restricted"
        | "recovery"
        | "unavailable";
      readonly message?: string;
    };

/** Optional hosted account actions; local composition supplies no account actions. */
export interface RuntimeAccountActions {
  readonly signIn: () => void;
  readonly signOut: () => Promise<void>;
  readonly openAccount: () => void;
  readonly loadUsage: (signal?: AbortSignal) => Promise<RuntimeUsage>;
}

/** User-facing units supplied by the consumer; prices and dispatch authority stay server-side. */
export interface RuntimeUsage {
  readonly units: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly used: number;
    readonly limit: number;
    readonly resetsAt?: string;
  }>;
}

/** Thin composition boundary injected by an explicit entrypoint into the common application. */
export interface ProductRuntimeComposition {
  readonly transport: ProductApiTransport;
  readonly accountActions?: RuntimeAccountActions;
  readonly readAdmission: (signal?: AbortSignal) => Promise<RuntimeAdmission>;
  readonly repair: (signal?: AbortSignal) => Promise<RuntimeAdmission>;
}

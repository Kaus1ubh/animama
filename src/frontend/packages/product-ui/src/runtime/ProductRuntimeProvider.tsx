import { createContext, useContext, useMemo, type ReactNode } from "react";
import type {
  ProductApiTransport,
  ProductRuntimeCapabilities,
  RuntimeOwner,
} from "@animama/runtime-contracts";
import { createClient, type Client } from "@animama/runtime-contracts/sdk";
import {
  ProductDiagnosticsContext,
  silentProductDiagnostics,
  type ProductDiagnostics,
} from "./diagnostics";

type ProductRuntime = {
  owner: RuntimeOwner;
  sessionKey: string;
  capabilities: ProductRuntimeCapabilities;
  transport: ProductApiTransport;
  client: Client;
};

const ProductRuntimeContext = createContext<ProductRuntime | null>(null);

/** Supply explicit composition inputs. QueryClientProvider remains the host's cache boundary. */
export function ProductRuntimeProvider({
  owner,
  capabilities,
  transport,
  sessionKey = owner.id,
  diagnostics = silentProductDiagnostics,
  children,
}: {
  owner: RuntimeOwner;
  capabilities: ProductRuntimeCapabilities;
  transport: ProductApiTransport;
  /** Changes on every admitted browser lifetime, including same-owner reauthentication. */
  sessionKey?: string;
  diagnostics?: ProductDiagnostics;
  children: ReactNode;
}) {
  const client = useMemo(
    () => createClient({ baseUrl: transport.baseUrl, fetch: transport.fetch }),
    [transport.baseUrl, transport.fetch],
  );
  const runtime = useMemo(
    () => ({ owner, sessionKey, capabilities, transport, client }),
    [owner, sessionKey, capabilities, transport, client],
  );
  return (
    <ProductRuntimeContext.Provider
      key={`${sessionKey}:${transport.baseUrl}`}
      value={runtime}
    >
      <ProductDiagnosticsContext.Provider value={diagnostics}>
        {children}
      </ProductDiagnosticsContext.Provider>
    </ProductRuntimeContext.Provider>
  );
}

export function useProductRuntime(): ProductRuntime {
  const runtime = useContext(ProductRuntimeContext);
  if (!runtime)
    throw new Error("Product features require ProductRuntimeProvider");
  return runtime;
}

/** Read the admitted principal, without importing installation readiness. */
export function useRuntimeOwnerId(): string | null {
  return useContext(ProductRuntimeContext)?.owner.id ?? null;
}

export function useProductApiClient(): Client {
  return useProductRuntime().client;
}

/** Private cache and recovery identity; this is never sent as an HTTP owner selector. */
export function useRuntimeCacheKey(): string | null {
  return useContext(ProductRuntimeContext)?.sessionKey || null;
}

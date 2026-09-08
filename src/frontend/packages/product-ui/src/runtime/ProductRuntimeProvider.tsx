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
  diagnostics = silentProductDiagnostics,
  children,
}: {
  owner: RuntimeOwner;
  capabilities: ProductRuntimeCapabilities;
  transport: ProductApiTransport;
  diagnostics?: ProductDiagnostics;
  children: ReactNode;
}) {
  const client = useMemo(
    () => createClient({ baseUrl: transport.baseUrl, fetch: transport.fetch }),
    [transport.baseUrl, transport.fetch],
  );
  const runtime = useMemo(
    () => ({ owner, capabilities, transport, client }),
    [owner, capabilities, transport, client],
  );
  return (
    <ProductRuntimeContext.Provider
      key={`${owner.id}:${transport.baseUrl}`}
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

/** Read only the cache partition, without importing installation readiness. */
export function useRuntimeOwnerId(): string | null {
  return useContext(ProductRuntimeContext)?.owner.id ?? null;
}

export function useProductApiClient(): Client {
  return useProductRuntime().client;
}

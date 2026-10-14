import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RuntimeOwnerProvider } from "@/app/runtime/RuntimeOwnerContext";
import { useDesktopFeaturePacks } from "@/hooks/useDesktopFeaturePacks";
import { useModelAssets } from "@/query/hooks/useModelAssets";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { useModelAssetAction } from "@/query/mutations/useModelAssetActions";
import { queryKeys } from "@/query/keys";

const owner = "coordination-fixture";
const assetId = "pocket-tts-voice-cloning-encoder";
const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
function Packs() {
  const packs = useDesktopFeaturePacks();
  return (
    <section>
      <output data-testid="packs">
        {JSON.stringify({
          busy: packs.busy,
          blocked: packs.blockedReason,
          pending: packs.pending,
          states: packs.packs.map((p) => p.state),
          error: packs.error,
        })}
      </output>
      <button onClick={() => void packs.run("install", "document-processing")}>
        Install pack
      </button>
    </section>
  );
}
function Assets() {
  const assets = useModelAssets();
  const action = useModelAssetAction();
  return (
    <section>
      <output data-testid="assets">
        {JSON.stringify({
          busy: action.busy,
          blocked: action.blockedReason,
          states: assets.data?.assets.map((a) => a.status),
          retries: [...assets.retryAssetIds],
          error: action.error?.message,
          pending: action.isPending,
        })}
      </output>
      <button onClick={() => action.mutate({ action: "install", assetId })}>
        Install voice
      </button>
      <button onClick={() => action.mutate({ action: "remove", assetId })}>
        Cancel voice
      </button>
    </section>
  );
}
/** Observes runtime capabilities, as dictation surfaces do. */
function Capabilities() {
  const capabilities = useRuntimeCapabilities();
  return <output data-testid="capabilities">{capabilities.status}</output>;
}
function Fixture() {
  const [show, setShow] = useState(true);
  return (
    <>
      <button onClick={() => setShow(!show)}>Toggle pack view</button>
      {show ? <Packs /> : null}
      <Assets />
      {location.search.includes("capabilities") ? <Capabilities /> : null}
    </>
  );
}
Object.assign(window, {
  refreshDownloads: () =>
    client.invalidateQueries({
      queryKey: queryKeys.modelAssets(owner),
      exact: true,
    }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <RuntimeOwnerProvider ownerId={owner}>
      <Fixture />
    </RuntimeOwnerProvider>
  </QueryClientProvider>,
);

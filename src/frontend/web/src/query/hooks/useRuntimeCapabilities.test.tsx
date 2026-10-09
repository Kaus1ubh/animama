import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { RuntimeOwnerProvider } from "@/app/runtime/RuntimeOwnerContext";
import { hostedCapabilitiesFixture } from "@/app/runtime/runtime-fixture";
import { queryKeys } from "@/query/keys";
import { useRuntimeCapabilities } from "./useRuntimeCapabilities";

describe("capability authority", () => {
  it("cannot widen hosted admission from a separately refreshed capabilities response", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.runtimeCapabilities("hosted:fixture"), {
      ...hostedCapabilitiesFixture,
      anima_creation: true,
      provider_credentials: true,
    });
    function Probe() {
      const { data } = useRuntimeCapabilities();
      return (
        <span>
          {String(data?.anima_creation)}|{String(data?.provider_credentials)}
        </span>
      );
    }
    const rendered = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <RuntimeOwnerProvider
          ownerId="owner"
          sessionKey="hosted:fixture"
          capabilities={hostedCapabilitiesFixture}
        >
          <Probe />
        </RuntimeOwnerProvider>
      </QueryClientProvider>,
    );
    expect(rendered).toContain("false|false");
    client.clear();
  });
});

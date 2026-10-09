// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  RuntimeAccountActions,
  RuntimeUsage,
} from "@animama/runtime-contracts";
import { ProductRuntimeProvider } from "@animama/product-ui";
import { describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/query/keys";
import { AccountUsage } from "./AccountUsage";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const usage: RuntimeUsage = {
  units: [{ id: "turns", label: "Daily turns", used: 3, limit: 40 }],
};

describe("account usage", () => {
  it("caches usage under the admitted session key", async () => {
    const loadUsage = vi.fn(async () => usage);
    const client = new QueryClient();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <ProductRuntimeProvider
            owner={{ id: "owner" }}
            sessionKey="session-1"
            capabilities={{ chat: true }}
            transport={{
              baseUrl: "http://runtime.fixture.test",
              fetch: () => Promise.reject(new Error("Unexpected request")),
            }}
          >
            <AccountUsage
              actions={{ loadUsage } as unknown as RuntimeAccountActions}
              open
              onOpenChange={() => {}}
            />
          </ProductRuntimeProvider>
        </QueryClientProvider>,
      );
    });
    expect(loadUsage).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(queryKeys.accountUsage("session-1"))).toBe(
      usage,
    );
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  });
});

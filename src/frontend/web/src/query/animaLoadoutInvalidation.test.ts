import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "@/query/keys";
import { invalidateAnimaLoadoutAndRuntime } from "./animaLoadoutInvalidation";

describe("invalidateAnimaLoadoutAndRuntime", () => {
  it("invalidates the detail and infinite-stale runtime caches together", async () => {
    const client = new QueryClient();
    const detail = queryKeys.animaLoadouts.detail("user-1", "anima-1");
    const runtime = queryKeys.animaLoadouts.runtime("user-1", "anima-1");
    client.setQueryData(detail, { revision: 1 });
    client.setQueryData(runtime, { effective_revision: "runtime-1" });

    await invalidateAnimaLoadoutAndRuntime(client, "user-1", "anima-1");

    expect(client.getQueryState(detail)?.isInvalidated).toBe(true);
    expect(client.getQueryState(runtime)?.isInvalidated).toBe(true);
  });
});

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "@/query/keys";
import {
  invalidateAnimaLoadoutAndRuntime,
  invalidateVoiceCloneConsumers,
} from "./animaLoadoutInvalidation";

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

  it("expires only this owner's Animas using the renamed clone, including runtime-only cached chats", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    });
    const selectedDetail = queryKeys.animaLoadouts.detail("owner", "selected");
    const selectedRuntime = queryKeys.animaLoadouts.runtime(
      "owner",
      "selected",
    );
    const runtimeOnly = queryKeys.animaLoadouts.runtime(
      "owner",
      "runtime-only",
    );
    const unrelated = queryKeys.animaLoadouts.runtime("owner", "unrelated");
    const otherOwner = queryKeys.animaLoadouts.runtime("other", "selected");
    client.setQueryData(selectedDetail, {
      voice_source: { catalog_item_id: "clone-1" },
    });
    client.setQueryData(selectedRuntime, {
      effective_revision: "before-rename",
    });
    client.setQueryData(runtimeOnly, {
      voice: { source: { item_id: "clone-1" } },
    });
    client.setQueryData(unrelated, {
      voice: { source: { item_id: "clone-2" } },
    });
    client.setQueryData(otherOwner, {
      voice: { source: { item_id: "clone-1" } },
    });

    await invalidateVoiceCloneConsumers(client, "owner", "clone-1");

    for (const key of [selectedDetail, selectedRuntime, runtimeOnly]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherOwner)?.isInvalidated).toBe(false);
    expect(client.getQueryData(selectedRuntime)).toEqual({
      effective_revision: "before-rename",
    });
    client.clear();
  });
});

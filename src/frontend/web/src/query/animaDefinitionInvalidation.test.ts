import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "@/query/keys";
import { invalidateAnimaDefinition } from "./animaDefinitionInvalidation";

describe("invalidateAnimaDefinition", () => {
  it("refreshes definition guards without remounting runtime or crossing owners", async () => {
    const client = new QueryClient();
    const affected = [
      queryKeys.animas.detail("owner", "anima"),
      queryKeys.animas.list("owner"),
      queryKeys.animaLoadouts.detail("owner", "anima"),
      queryKeys.memoryEntries.byPath("owner", {
        animaId: "anima",
        path: "IDENTITY.md",
        type: "file",
      }),
    ];
    const unaffected = [
      queryKeys.animaLoadouts.runtime("owner", "anima"),
      queryKeys.animas.detail("other-owner", "anima"),
      queryKeys.animas.detail("owner", "other-anima"),
      queryKeys.memoryEntries.byPath("owner", {
        animaId: null,
        path: "profile.md",
        type: "file",
      }),
    ];
    for (const key of [...affected, ...unaffected])
      client.setQueryData(key, {});

    await invalidateAnimaDefinition(client, "owner", "anima");

    for (const key of affected)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of unaffected)
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });
});

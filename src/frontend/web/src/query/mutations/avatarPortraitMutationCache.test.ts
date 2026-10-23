import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "@/query/keys";
import { invalidateAvatarPortraitPresentation } from "./avatarPortraitMutationCache";

describe("invalidateAvatarPortraitPresentation", () => {
  it("refreshes Avatar metadata and every Anima presentation consumer", async () => {
    const client = new QueryClient();
    const avatars = queryKeys.avatars.list("user-1", true);
    const animas = queryKeys.animas.list("user-1");
    const library = queryKeys.avatarCatalog.list("user-1", "", "all", "name");
    const creation = queryKeys.animaCreation.list("user-1", "avatar");
    const unrelated = queryKeys.gestures.all("user-1");
    for (const key of [avatars, animas, library, creation, unrelated])
      client.setQueryData(key, []);

    await invalidateAvatarPortraitPresentation(client, "user-1");

    for (const key of [avatars, animas, library, creation])
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });
});

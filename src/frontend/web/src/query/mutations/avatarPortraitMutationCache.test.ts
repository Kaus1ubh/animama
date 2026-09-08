import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { queryKeys } from "@/query/keys";
import { invalidateAvatarPortraitPresentation } from "./avatarPortraitMutationCache";

describe("invalidateAvatarPortraitPresentation", () => {
  it("refreshes Avatar metadata and every Anima presentation consumer", async () => {
    const client = new QueryClient();
    const avatars = queryKeys.avatars.list("user-1", true);
    const animas = queryKeys.animas.list("user-1");
    const unrelated = queryKeys.gestures.all("user-1");
    client.setQueryData(avatars, []);
    client.setQueryData(animas, []);
    client.setQueryData(unrelated, []);

    await invalidateAvatarPortraitPresentation(client, "user-1");

    expect(client.getQueryState(avatars)?.isInvalidated).toBe(true);
    expect(client.getQueryState(animas)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });
});

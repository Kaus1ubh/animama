import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { PyUserProfile } from "@/lib/content/catalogTypes";
import { queryKeys } from "@/query/keys";
import { publishUserProfile } from "@/query/mutations/userProfileMutationCache";

const profile: PyUserProfile = { display_name: "Test User" };

describe("local personalization mutation cache", () => {
  it("publishes the authoritative profile only under its runtime owner ID", () => {
    const queryClient = new QueryClient();

    publishUserProfile(queryClient, "installation-1", profile);

    expect(
      queryClient.getQueryData(queryKeys.userProfile.current("installation-1")),
    ).toEqual(profile);
    expect(
      queryClient.getQueryData(queryKeys.userProfile.current("installation-2")),
    ).toBeUndefined();
  });
});

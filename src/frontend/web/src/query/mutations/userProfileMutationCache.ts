import type { QueryClient } from "@tanstack/react-query";

import type { PyUserProfile } from "@/lib/content/catalogTypes";
import { queryKeys } from "@/query/keys";

/** Publish the authoritative User Profile returned by a successful mutation. */
export function publishUserProfile(
  queryClient: QueryClient,
  userId: string,
  profile: PyUserProfile,
) {
  queryClient.setQueryData(queryKeys.userProfile.current(userId), profile);
}

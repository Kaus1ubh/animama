import type { Client } from "@animama/runtime-contracts/sdk";
import { useProductApiClient } from "@animama/product-ui";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPose, listPoses } from "@animama/runtime-contracts/sdk";
import type { PyPose, PyPosePage } from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { matchesContentName } from "@/lib/content/librarySearch";
import { compareDisplayText } from "@animama/product-ui/i18n";

/** Naming must use the current complete catalog; this endpoint is not paginated. */
export async function fetchPoseNames(apiClient: Client): Promise<string[]> {
  const { data } = await listPoses({
    client: apiClient,
    responseValidator: undefined,
    throwOnError: true,
  });
  return data.items.map((item) => item.name);
}

/**
 * List metadata only; registered Pose bytes are loaded on demand. The whole
 * list is cached once per owner and each caller's origin and search filter it
 * locally, so typing a search never re-downloads the list.
 */
export function usePoses(
  input: {
    query?: string;
    origin?: "all" | "builtin" | "owned";
    enabled?: boolean;
  } = {},
) {
  const apiClient = useProductApiClient();

  const owner = useRuntimeCacheKey();
  const query = input.query ?? "";
  const origin = input.origin ?? "all";
  const select = useCallback(
    (page: PyPosePage): PyPosePage => ({
      ...page,
      items: page.items.filter(
        (item) =>
          (origin === "all" ||
            item.source === (origin === "builtin" ? "included" : "local")) &&
          matchesContentName(item.name, query),
      ),
    }),
    [origin, query],
  );
  return useQuery<PyPosePage>({
    queryKey: queryKeys.poses.list(owner ?? "__anon__"),
    enabled: Boolean(owner) && input.enabled !== false,
    queryFn: async ({ signal }) => {
      const { data } = await listPoses({
        client: apiClient,
        signal,
        responseValidator: undefined,
        throwOnError: true,
      });
      return {
        ...data,
        items: [...data.items].sort((a, b) =>
          compareDisplayText(a.name, b.name),
        ),
      };
    },
    select,
  });
}

/** Read a single owner-admitted Pose without duplicating its payload in client state. */
export function usePose(itemId: string | null) {
  const apiClient = useProductApiClient();

  const owner = useRuntimeCacheKey();
  return useQuery<PyPose>({
    queryKey: queryKeys.poses.detail(owner ?? "__anon__", itemId ?? "__none__"),
    enabled: Boolean(owner && itemId),
    queryFn: async ({ signal }) =>
      (
        await getPose({
          client: apiClient,
          path: { item_id: itemId! },
          signal,
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data,
  });
}

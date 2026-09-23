"use client";

import { useQuery } from "@tanstack/react-query";
import { getPose, listPoses } from "@animama/runtime-contracts/sdk";
import type { PyPose, PyPosePage } from "@animama/runtime-contracts/api-types";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

/** Naming must use the current complete catalog; this endpoint is not paginated. */
export async function fetchPoseNames(): Promise<string[]> {
  const { data } = await listPoses({
    responseValidator: undefined,
    throwOnError: true,
  });
  return data.items.map((item) => item.name);
}

/** List metadata only; registered Pose bytes are loaded on demand. */
export function usePoses(
  input: {
    query?: string;
    origin?: "all" | "builtin" | "owned";
    enabled?: boolean;
  } = {},
) {
  const owner = useRuntimeOwnerId();
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const origin = input.origin ?? "all";
  return useQuery<PyPosePage>({
    queryKey: queryKeys.poses.list(owner ?? "__anon__", query, origin),
    enabled: Boolean(owner) && input.enabled !== false,
    queryFn: async ({ signal }) => {
      const { data } = await listPoses({
        signal,
        responseValidator: undefined,
        throwOnError: true,
      });
      return {
        ...data,
        items: data.items
          .filter(
            (item) =>
              (origin === "all" ||
                item.source ===
                  (origin === "builtin" ? "included" : "local")) &&
              (!query ||
                item.name.toLocaleLowerCase().includes(query) ||
                item.description?.toLocaleLowerCase().includes(query)),
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
  });
}

/** Read a single owner-admitted Pose without duplicating its payload in client state. */
export function usePose(itemId: string | null) {
  const owner = useRuntimeOwnerId();
  return useQuery<PyPose>({
    queryKey: queryKeys.poses.detail(owner ?? "__anon__", itemId ?? "__none__"),
    enabled: Boolean(owner && itemId),
    queryFn: async ({ signal }) =>
      (
        await getPose({
          path: { item_id: itemId! },
          signal,
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data,
  });
}

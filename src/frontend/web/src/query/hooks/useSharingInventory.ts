import { useProductApiClient } from "@animama/product-ui";
import { useQuery } from "@tanstack/react-query";
import {
  listAvatarContents,
  listAvatarEffects,
  listGestures,
  listIdleStyles,
  listParticleEffects,
  listPoses,
  listReactions,
  listSceneEffects,
  listSoundEffects,
} from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import type { SharingItem } from "@/lib/content-sharing/types";
import { isNonPortable } from "@/lib/content/portability";
import { queryKeys } from "@/query/keys";

/** The typed family endpoints return complete inventories; no catalog metadata decoding. */
export function useSharingInventory(enabled: boolean) {
  const apiClient = useProductApiClient();

  const owner = useRuntimeCacheKey();
  return useQuery({
    queryKey: queryKeys.content.sharingInventory(owner ?? "__anon__"),
    enabled: enabled && Boolean(owner),
    retry: false,
    staleTime: 0,
    queryFn: async ({ signal }): Promise<SharingItem[]> => {
      const options = {
        signal,
        responseValidator: undefined,
        throwOnError: true as const,
      };
      const pages = await Promise.all([
        listAvatarContents({ ...options, client: apiClient }),
        listGestures({ ...options, client: apiClient }),
        listReactions({ ...options, client: apiClient }),
        listIdleStyles({ ...options, client: apiClient }),
        listPoses({ ...options, client: apiClient }),
        listParticleEffects({ ...options, client: apiClient }),
        listAvatarEffects({ ...options, client: apiClient }),
        listSceneEffects({ ...options, client: apiClient }),
        listSoundEffects({ ...options, client: apiClient }),
      ]);
      return pages
        .flatMap((page) =>
          page.data.items
            // Licensed sounds travel with nothing; they aren't listed.
            .filter(
              (item) => !(item.kind === "sound_effect" && isNonPortable(item)),
            )
            .map(({ item_id, name, kind, description, portability }) => ({
              item_id,
              name,
              kind: kind ?? "pose",
              description,
              portability,
            })),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

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
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import type { SharingItem } from "@/lib/content-sharing/types";
import { queryKeys } from "@/query/keys";

/** The typed family endpoints return complete inventories; no catalog metadata decoding. */
export function useSharingInventory(enabled: boolean) {
  const owner = useRuntimeOwnerId();
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
        listAvatarContents(options),
        listGestures(options),
        listReactions(options),
        listIdleStyles(options),
        listPoses(options),
        listParticleEffects(options),
        listAvatarEffects(options),
        listSceneEffects(options),
        listSoundEffects(options),
      ]);
      return pages
        .flatMap((page) =>
          page.data.items.map(
            ({ item_id, name, kind, description, portability }) => ({
              item_id,
              name,
              kind: kind ?? "pose",
              description,
              portability,
            }),
          ),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

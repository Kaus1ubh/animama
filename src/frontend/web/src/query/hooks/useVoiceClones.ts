import { useProductApiClient } from "@animama/product-ui";
import { useQuery } from "@tanstack/react-query";
import { listVoiceContents } from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { POCKET_VOICE_CLONE_CODEC } from "@/lib/speech/pocket/voice-clones";
import { queryKeys } from "@/query/keys";

/** Installation-owner library, independent of the current Anima or TTS provider. */
export function useVoiceClones({ enabled = true }: { enabled?: boolean } = {}) {
  const apiClient = useProductApiClient();

  const owner = useRuntimeCacheKey();
  return useQuery({
    queryKey: queryKeys.voiceContent.list(owner ?? "__anon__"),
    enabled: Boolean(owner) && enabled,
    queryFn: async ({ signal }) => {
      const { data } = await listVoiceContents({
        client: apiClient,
        signal,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data.items.filter(
        (item) => item.codec === POCKET_VOICE_CLONE_CODEC,
      );
    },
  });
}

import { useProductApiClient } from "../../runtime/ProductRuntimeProvider";

import { useQuery } from "@tanstack/react-query";
import { listChatMessagesV1ChatsChatIdMessagesGet } from "@animama/runtime-contracts/sdk";
import type { PyChatMessage } from "@animama/runtime-contracts/api-types";
import { queryKeys } from "../keys";
import { useRuntimeCacheKey } from "../../runtime/ProductRuntimeProvider";

export type UseChatMessagesOptions = {
  enabled?: boolean;
};

export function useChatMessages(
  chatId: string | null | undefined,
  opts?: UseChatMessagesOptions,
) {
  const client = useProductApiClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const enabled = (opts?.enabled ?? true) && Boolean(chatId) && Boolean(userId);
  const keyId = chatId || "__none__";

  return useQuery<PyChatMessage[]>({
    queryKey: queryKeys.chats.messages(userKey, keyId),
    enabled,
    queryFn: async () => {
      if (!chatId) return [];
      const { data: payload } = await listChatMessagesV1ChatsChatIdMessagesGet({
        client,
        path: { chat_id: chatId },
        query: { order: "asc" },
        responseValidator: undefined,
        throwOnError: true,
      });
      return payload?.messages ?? [];
    },
  });
}

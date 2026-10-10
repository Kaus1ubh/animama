import { useProductApiClient } from "../../runtime/ProductRuntimeProvider";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getChatV1ChatsChatIdGet } from "@animama/runtime-contracts/sdk";
import type { PyChatResponse } from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "../../runtime/ProductRuntimeProvider";
import { queryKeys } from "../keys";

export type UseChatOptions = {
  enabled?: boolean;
};

function findCachedChat(
  rows: PyChatResponse[] | undefined,
  chatId: string,
): PyChatResponse | undefined {
  return Array.isArray(rows)
    ? rows.find((chat) => chat.id === chatId)
    : undefined;
}

export function useChat(
  chatId: string | null | undefined,
  opts?: UseChatOptions,
) {
  const queryClient = useQueryClient();
  const client = useProductApiClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const enabled = (opts?.enabled ?? true) && Boolean(chatId) && Boolean(userId);
  const keyId = chatId || "__none__";

  return useQuery<PyChatResponse | null>({
    queryKey: queryKeys.chats.detail(userKey, keyId),
    enabled,
    initialData: () => {
      if (!chatId) return null;
      return (
        findCachedChat(
          queryClient.getQueryData(
            queryKeys.chats.list(userKey, { includeLastMessageAt: true }),
          ),
          chatId,
        ) ??
        findCachedChat(
          queryClient.getQueryData(
            queryKeys.chats.list(userKey, { includeLastMessageAt: false }),
          ),
          chatId,
        ) ??
        undefined
      );
    },
    queryFn: async () => {
      if (!chatId) return null;
      const { data } = await getChatV1ChatsChatIdGet({
        client,
        path: { chat_id: chatId },
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

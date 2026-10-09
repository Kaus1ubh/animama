import { useProductApiClient } from "../../runtime/ProductRuntimeProvider";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createChatV1ChatsPost } from "@animama/runtime-contracts/sdk";
import type {
  PyChatCreate,
  PyChatResponse,
} from "@animama/runtime-contracts/api-types";
import { queryKeys } from "../keys";
import { useRuntimeCacheKey } from "../../runtime/ProductRuntimeProvider";
import { withRetryAfter } from "../../lib/chat/retry-after";

/**
 * Create the chat for a first message. A failure rejects with the parsed error
 * body (or the transport error when no response arrived), which chat failure
 * copy classifies, including hosted denials with their `Retry-After` wait.
 */
export function useCreateChat() {
  const queryClient = useQueryClient();
  const client = useProductApiClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation({
    retry: false,
    mutationFn: async ({
      body,
      headers,
    }: {
      body: PyChatCreate;
      headers?: Record<string, string>;
    }) => {
      const result = await createChatV1ChatsPost({
        client,
        body,
        headers,
        responseValidator: undefined,
        throwOnError: false,
      });
      if (result.error !== undefined)
        throw withRetryAfter(result.error, result.response?.headers);
      return result.data;
    },
    onSuccess: (created) => {
      if (!userId) return;
      queryClient.setQueryData<PyChatResponse>(
        queryKeys.chats.detail(userKey, created.id),
        created,
      );
      if (!created.title?.trim()) return;
      queryClient.setQueryData<PyChatResponse[]>(
        queryKeys.chats.list(userKey, { includeLastMessageAt: true }),
        (prev) => {
          const rows = Array.isArray(prev) ? prev : [];
          if (rows.some((chat) => chat.id === created.id)) return rows;
          return [created, ...rows];
        },
      );
      queryClient.setQueryData<PyChatResponse[]>(
        queryKeys.chats.list(userKey, { includeLastMessageAt: false }),
        (prev) => {
          const rows = Array.isArray(prev) ? prev : [];
          if (rows.some((chat) => chat.id === created.id)) return rows;
          return [created, ...rows];
        },
      );
    },
  });
}

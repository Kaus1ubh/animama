import { useProductApiClient } from "../../runtime/ProductRuntimeProvider";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createChatV1ChatsPost } from "@animama/runtime-contracts/sdk";
import type {
  PyChatCreate,
  PyChatResponse,
} from "@animama/runtime-contracts/api-types";
import { queryKeys } from "../keys";
import { useRuntimeOwnerId } from "../../runtime/ProductRuntimeProvider";

export function useCreateChat() {
  const queryClient = useQueryClient();
  const client = useProductApiClient();
  const userId = useRuntimeOwnerId();
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
      const { data: created } = await createChatV1ChatsPost({
        client,
        body,
        headers,
        responseValidator: undefined,
        throwOnError: true,
      });
      return created;
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

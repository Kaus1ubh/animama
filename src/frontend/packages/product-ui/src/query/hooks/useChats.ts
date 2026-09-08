import { useProductApiClient } from "../../runtime/ProductRuntimeProvider";

import { useQuery } from "@tanstack/react-query";
import { listChatsV1ChatsGet } from "@animama/runtime-contracts/sdk";
import type { PyChatResponse } from "@animama/runtime-contracts/api-types";
import { queryKeys } from "../keys";
import { useRuntimeOwnerId } from "../../runtime/ProductRuntimeProvider";

export type UseChatsOptions = {
  includeLastMessageAt?: boolean;
  animaId?: string | null;
  enabled?: boolean;
};

export function useChats(opts?: UseChatsOptions) {
  const client = useProductApiClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";
  const includeLastMessageAt = opts?.includeLastMessageAt ?? true;
  const enabled = (opts?.enabled ?? true) && Boolean(userId);
  const animaId = opts?.animaId ?? null;

  return useQuery<PyChatResponse[]>({
    queryKey: queryKeys.chats.list(userKey, {
      includeLastMessageAt,
    }),
    enabled,
    queryFn: async () => {
      const { data } = await listChatsV1ChatsGet({
        client,
        query: { include_last_message_at: includeLastMessageAt },
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
    select: (rows) => {
      const filtered = animaId
        ? rows.filter((chat) => chat.anima_id === animaId)
        : rows;
      return filtered
        .slice()
        .sort(
          (a, b) =>
            (Date.parse(
              b.last_message_at ?? b.updated_at ?? b.created_at ?? "",
            ) || 0) -
            (Date.parse(
              a.last_message_at ?? a.updated_at ?? a.created_at ?? "",
            ) || 0),
        );
    },
  });
}

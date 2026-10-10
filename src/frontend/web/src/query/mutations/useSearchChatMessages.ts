"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation } from "@tanstack/react-query";

import { searchChatMessagesV1ChatsSearchPost } from "@animama/runtime-contracts/sdk";
import type {
  PyChatSearchRequest,
  PyChatSearchResponse,
} from "@/lib/content/catalogTypes";

export type SearchChatMessagesArgs = PyChatSearchRequest;

export function useSearchChatMessages() {
  const apiClient = useProductApiClient();

  return useMutation<PyChatSearchResponse, Error, SearchChatMessagesArgs>({
    mutationFn: async (body) => {
      const { data } = await searchChatMessagesV1ChatsSearchPost({
        client: apiClient,
        body,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

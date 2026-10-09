"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation } from "@tanstack/react-query";

import { searchUserFileChunksV1FilesDebugSearchPost } from "@animama/runtime-contracts/sdk";
import type {
  PyUserFileSearchRequest,
  PyUserFileSearchResponse,
} from "@/lib/content/catalogTypes";

export type DebugUserFileSearchArgs = PyUserFileSearchRequest;

export function useDebugUserFileSearch() {
  const apiClient = useProductApiClient();

  return useMutation<PyUserFileSearchResponse, Error, DebugUserFileSearchArgs>({
    mutationFn: async (body) => {
      const { data } = await searchUserFileChunksV1FilesDebugSearchPost({
        client: apiClient,
        body,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

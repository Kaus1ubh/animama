"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation } from "@tanstack/react-query";

import { debugSearchMemoryFilesV1MemoryDebugSearchMemoryFilesPost } from "@animama/runtime-contracts/sdk";
import type {
  PySearchMemoryFilesDebugRequest,
  PySearchMemoryFilesDebugResponse,
} from "@/lib/content/catalogTypes";

export type DebugSearchMemoryFilesArgs = PySearchMemoryFilesDebugRequest;

export function useDebugSearchMemoryFiles() {
  const apiClient = useProductApiClient();

  return useMutation<
    PySearchMemoryFilesDebugResponse,
    Error,
    DebugSearchMemoryFilesArgs
  >({
    mutationFn: async (body) => {
      const { data } =
        await debugSearchMemoryFilesV1MemoryDebugSearchMemoryFilesPost({
          client: apiClient,
          body,
          responseValidator: undefined,
          throwOnError: true,
        });
      return data;
    },
  });
}

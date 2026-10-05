"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { processUserFileV1FilesFileIdProcessPost } from "@animama/runtime-contracts/sdk";
import type { PyUserFileProcessResponse } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type ProcessUserFileArgs = {
  fileId: string;
  force?: boolean;
};

export function useProcessUserFile() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<PyUserFileProcessResponse, Error, ProcessUserFileArgs>({
    mutationFn: async ({ fileId, force = false }) => {
      const { data } = await processUserFileV1FilesFileIdProcessPost({
        client: apiClient,
        path: { file_id: fileId },
        body: { force },
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
    onSettled: () => {
      if (!userId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.userFiles.all(userKey),
      });
    },
  });
}

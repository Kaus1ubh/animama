import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { initUserFileUploadV1FilesUploadsPost } from "@animama/runtime-contracts/sdk";
import type { PyUserFileUploadInitResponse } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type InitUserFileUploadArgs = {
  file: File;
};

export function useInitUserFileUpload() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<
    PyUserFileUploadInitResponse,
    Error,
    InitUserFileUploadArgs
  >({
    mutationFn: async ({ file }) => {
      const { data } = await initUserFileUploadV1FilesUploadsPost({
        client: apiClient,
        body: {
          filename: file.name,
          content_type: file.type || undefined,
          size_bytes: file.size,
        },
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

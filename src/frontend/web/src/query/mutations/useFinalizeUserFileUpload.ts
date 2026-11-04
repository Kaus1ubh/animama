import { useProductApiClient } from "@animama/product-ui";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { finalizeUserFileUploadV1FilesFileIdFinalizePost } from "@animama/runtime-contracts/sdk";
import type { PyUserFileResponse } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type FinalizeUserFileUploadArgs = {
  fileId: string;
};

export function useFinalizeUserFileUpload() {
  const apiClient = useProductApiClient();

  const queryClient = useQueryClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";

  return useMutation<PyUserFileResponse, Error, FinalizeUserFileUploadArgs>({
    mutationFn: async ({ fileId }) => {
      const { data } = await finalizeUserFileUploadV1FilesFileIdFinalizePost({
        client: apiClient,
        path: { file_id: fileId },
        body: {},
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

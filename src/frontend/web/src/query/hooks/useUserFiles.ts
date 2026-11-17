import { useProductApiClient } from "@animama/product-ui";

import { useQuery } from "@tanstack/react-query";

import { listUserFilesV1FilesGet } from "@animama/runtime-contracts/sdk";
import type { PyUserFileResponse } from "@/lib/content/catalogTypes";
import { libraryUploadRefetchInterval } from "@/lib/uploads/libraryUploads";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type UseUserFilesOptions = {
  enabled?: boolean;
  pollActive?: boolean;
};

export function useUserFiles(opts?: UseUserFilesOptions) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const enabled = (opts?.enabled ?? true) && Boolean(userId);

  return useQuery<PyUserFileResponse[]>({
    queryKey: queryKeys.userFiles.list(userKey),
    enabled,
    queryFn: async () => {
      const { data } = await listUserFilesV1FilesGet({
        client: apiClient,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data.files;
    },
    refetchInterval: (query) => {
      const files = query.state.data ?? [];
      return libraryUploadRefetchInterval(files, opts?.pollActive === true);
    },
  });
}

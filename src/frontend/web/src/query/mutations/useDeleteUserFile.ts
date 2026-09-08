"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { deleteUserFileV1FilesFileIdDelete } from "@animama/runtime-contracts/sdk";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type DeleteUserFileArgs = {
  fileId: string;
};

export function useDeleteUserFile() {
  const queryClient = useQueryClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";

  return useMutation<void, Error, DeleteUserFileArgs>({
    mutationFn: async ({ fileId }) => {
      await deleteUserFileV1FilesFileIdDelete({
        path: { file_id: fileId },
        responseValidator: undefined,
        throwOnError: true,
      });
    },
    onSettled: () => {
      if (!userId) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.userFiles.all(userKey),
      });
    },
  });
}

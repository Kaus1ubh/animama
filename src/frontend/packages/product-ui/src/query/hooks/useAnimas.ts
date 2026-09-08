import { useProductApiClient } from "../../runtime/ProductRuntimeProvider";

import { useQuery } from "@tanstack/react-query";
import { listAnimasV1AnimasGet } from "@animama/runtime-contracts/sdk";
import type { PyAnimaListItem } from "@animama/runtime-contracts/api-types";
import { queryKeys } from "../keys";
import { useRuntimeOwnerId } from "../../runtime/ProductRuntimeProvider";

export type UseAnimasOptions = {
  enabled?: boolean;
};

export function useAnimas(opts?: UseAnimasOptions) {
  const client = useProductApiClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";
  const enabled = (opts?.enabled ?? true) && Boolean(userId);

  return useQuery<PyAnimaListItem[]>({
    queryKey: queryKeys.animas.list(userKey),
    enabled,
    queryFn: async () => {
      const { data } = await listAnimasV1AnimasGet({
        client,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

import { useProductApiClient } from "../../runtime/ProductRuntimeProvider";

import { useQuery } from "@tanstack/react-query";
import { listModelProvidersV1ModelProvidersGet } from "@animama/runtime-contracts/sdk";
import type { PyModelProviderCatalogItem } from "@animama/runtime-contracts/api-types";
import { useRuntimeOwnerId } from "../../runtime/ProductRuntimeProvider";
import { queryKeys } from "../keys";

export function useModelProviders() {
  const client = useProductApiClient();
  const userId = useRuntimeOwnerId();
  const userKey = userId ?? "__anon__";

  return useQuery<PyModelProviderCatalogItem[]>({
    queryKey: queryKeys.modelProviders.all(userKey),
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await listModelProvidersV1ModelProvidersGet({
        client,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}

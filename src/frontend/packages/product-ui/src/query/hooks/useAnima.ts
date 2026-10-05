import { useProductApiClient } from "../../runtime/ProductRuntimeProvider";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAnimaV1AnimasAnimaIdGet } from "@animama/runtime-contracts/sdk";
import type { PyAnimaResponse } from "@animama/runtime-contracts/api-types";
import { queryKeys } from "../keys";
import { useProductLogger } from "../../runtime/diagnostics";
import { useRuntimeCacheKey } from "../../runtime/ProductRuntimeProvider";

export type UseAnimaOptions = {
  enabled?: boolean;
};

export function useAnima(
  animaId: string | null | undefined,
  opts?: UseAnimaOptions,
) {
  const logger = useProductLogger("useAnima");
  const client = useProductApiClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const enabled =
    (opts?.enabled ?? true) && Boolean(animaId) && Boolean(userId);
  const keyId = animaId || "__none__";

  const query = useQuery<PyAnimaResponse | null>({
    queryKey: queryKeys.animas.detail(userKey, keyId),
    enabled,
    queryFn: async () => {
      if (!animaId) return null;
      logger.info("queryFn", "Fetching anima", {
        animaId,
      });
      const { data } = await getAnimaV1AnimasAnimaIdGet({
        client,
        path: { anima_id: animaId },
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });

  useEffect(() => {
    if (!enabled) return;
    if (!query.isSuccess || query.isPlaceholderData) return;
    logger.info("Update", "Anima loaded", {
      animaId,
    });
  }, [
    enabled,
    query.isSuccess,
    query.isPlaceholderData,
    query.data,
    animaId,
    logger,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (!query.isError) return;
    logger.error("Update", "Anima load failed", query.error);
  }, [enabled, query.isError, query.error, logger]);

  return query;
}

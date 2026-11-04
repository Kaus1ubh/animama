import { useProductApiClient } from "@animama/product-ui";

import { useEffect, useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import {
  getAnimaSettingsV1AnimasAnimaIdSettingsGet,
  type Client,
} from "@animama/runtime-contracts/sdk";
import type { PyAnimaSettings } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { createLogger } from "@/lib/logger";
import { useAnimas } from "@/query/hooks/useAnimas";
import { queryKeys } from "@/query/keys";

/** One Anima's settings fetch, shared by every hook reading them. */
async function fetchAnimaSettings(
  apiClient: Client,
  animaId: string,
): Promise<PyAnimaSettings> {
  const { data } = await getAnimaSettingsV1AnimasAnimaIdSettingsGet({
    client: apiClient,
    path: { anima_id: animaId },
    responseValidator: undefined,
    throwOnError: true,
  });
  return data;
}

export type UseAnimaSettingsOptions = {
  enabled?: boolean;
};

export function useAnimaSettings(
  animaId: string | null | undefined,
  opts?: UseAnimaSettingsOptions,
) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const keyId = animaId ?? "__none__";
  const enabled =
    (opts?.enabled ?? true) && Boolean(userId) && Boolean(animaId);
  const logger = useMemo(() => createLogger("AnimaSettingsQuery"), []);

  const query = useQuery<PyAnimaSettings>({
    queryKey: queryKeys.settings.anima(userKey, keyId),
    enabled,
    queryFn: async () => {
      if (!animaId) {
        throw new Error("Missing anima id.");
      }
      const data = await fetchAnimaSettings(apiClient, animaId);
      logger.info("Fetch", "Anima settings fetched", { animaId });
      return data;
    },
  });

  useEffect(() => {
    if (!enabled) return;
    if (!query.isSuccess) return;
    logger.info("Fetch", "Fetched anima settings", {
      userId,
      animaId,
    });
  }, [enabled, logger, animaId, query.isSuccess, userId]);

  useEffect(() => {
    if (!enabled) return;
    if (!query.isError) return;
    logger.error("Fetch", "Anima settings fetch failed", query.error);
  }, [enabled, logger, query.error, query.isError]);

  return query;
}

/** An Anima and its settings, once they have loaded. */
export type AnimaWithSettings = {
  animaId: string;
  displayName: string;
  settings: PyAnimaSettings;
};

/**
 * Every Anima's settings, in Anima list order, under the same cache entries
 * as `useAnimaSettings`. Animas whose settings are still loading or failed
 * are left out, so callers can offer what is available.
 */
export function useAllAnimaSettings(opts?: UseAnimaSettingsOptions) {
  const apiClient = useProductApiClient();
  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const enabled = (opts?.enabled ?? true) && Boolean(userId);
  const animas = useAnimas({ enabled });
  const list = animas.data ?? [];
  return useQueries({
    queries: list.map((anima) => ({
      queryKey: queryKeys.settings.anima(userKey, anima.id),
      enabled,
      queryFn: () => fetchAnimaSettings(apiClient, anima.id),
    })),
    combine: (results): AnimaWithSettings[] =>
      results.flatMap((result, index) =>
        result.data
          ? [
              {
                animaId: list[index]!.id,
                displayName: list[index]!.display_name,
                settings: result.data,
              },
            ]
          : [],
      ),
  });
}

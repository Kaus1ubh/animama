"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getAnimaSettingsV1AnimasAnimaIdSettingsGet } from "@animama/runtime-contracts/sdk";
import type { PyAnimaSettings } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { createLogger } from "@/lib/logger";
import { queryKeys } from "@/query/keys";

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
      const { data } = await getAnimaSettingsV1AnimasAnimaIdSettingsGet({
        client: apiClient,
        path: { anima_id: animaId },
        responseValidator: undefined,
        throwOnError: true,
      });
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

"use client";

import { useProductApiClient } from "@animama/product-ui";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getUserSettingsV1UsersMeSettingsGet } from "@animama/runtime-contracts/sdk";
import type { PyUserSettings } from "@/lib/content/catalogTypes";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { createLogger } from "@/lib/logger";
import { queryKeys } from "@/query/keys";

export type UseUserSettingsOptions = {
  enabled?: boolean;
};

export function useUserSettings(opts?: UseUserSettingsOptions) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const userKey = userId ?? "__anon__";
  const enabled = (opts?.enabled ?? true) && Boolean(userId);
  const logger = useMemo(() => createLogger("UserSettingsQuery"), []);

  const query = useQuery<PyUserSettings>({
    queryKey: queryKeys.settings.user(userKey),
    enabled,
    queryFn: async () => {
      const { data } = await getUserSettingsV1UsersMeSettingsGet({
        client: apiClient,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });

  useEffect(() => {
    if (!enabled) return;
    if (!query.isSuccess) return;
    logger.info("Fetch", "Fetched user settings", { userId });
  }, [enabled, logger, query.isSuccess, userId]);

  useEffect(() => {
    if (!enabled) return;
    if (!query.isError) return;
    logger.error("Fetch", "User settings fetch failed", query.error);
  }, [enabled, logger, query.error, query.isError]);

  return query;
}

"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AvatarSettingsState } from "@animama/runtime-contracts/api-types";
import { getAvatarSettings } from "@animama/runtime-contracts/sdk";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import type {
  AvatarMaterialMode,
  AvatarSpringMode,
} from "@/lib/avatar/avatarSettings";
import { queryKeys } from "@/query/keys";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { useProductApiClient } from "@animama/product-ui";

/**
 * Whether this runtime stores Avatar settings. Only the local runtimes do;
 * the hosted web app never calls the local-only route.
 */
export function useAvatarSettingsAvailable(): {
  available: boolean;
  /** True while the runtime's capabilities are still being read. */
  checking: boolean;
} {
  const capabilities = useRuntimeCapabilities();
  const kind = capabilities.data?.runtime_kind;
  return {
    available: kind === "desktop" || kind === "self_hosted_web",
    checking: capabilities.isLoading,
  };
}

/** An Avatar item's stored wind and material settings (local runtimes). */
export function useAvatarSettings(itemId: string | null) {
  const userId = useRuntimeCacheKey();
  const client = useProductApiClient();
  const { available } = useAvatarSettingsAvailable();
  return useQuery<AvatarSettingsState>({
    queryKey: queryKeys.avatars.settings(
      userId ?? "__anon__",
      itemId ?? "__none__",
    ),
    enabled: Boolean(available && userId && itemId),
    // A failed read means Automatic; retrying would only hold the load.
    retry: false,
    queryFn: async ({ signal }) =>
      (
        await getAvatarSettings({
          client,
          path: { item_id: itemId! },
          signal,
          throwOnError: true,
        })
      ).data,
  });
}

export type AvatarLoadSettings = {
  springMode: AvatarSpringMode;
  /** The spring mode now, for a load that starts later than this render. */
  springModeRef: { readonly current: AvatarSpringMode };
  /**
   * The material mode to load with, or null while the settings are still
   * being read (materials are built at load, so a surface waits rather than
   * loading twice). A failed or unavailable read is Automatic.
   */
  materialMode: AvatarMaterialMode | null;
};

/**
 * The settings a surface loads an Avatar item with. Without an item (an
 * unsaved file) or outside the local runtimes both are Automatic.
 */
export function useAvatarLoadSettings(
  itemId: string | null,
): AvatarLoadSettings {
  const { checking } = useAvatarSettingsAvailable();
  const settings = useAvatarSettings(itemId);
  const springMode = settings.data?.spring_mode ?? "automatic";
  const springModeRef = useRef(springMode);
  useEffect(() => {
    springModeRef.current = springMode;
  }, [springMode]);
  const reading = Boolean(itemId) && (checking || settings.isLoading);
  return {
    springMode,
    springModeRef,
    materialMode: reading
      ? null
      : (settings.data?.material_mode ?? "automatic"),
  };
}

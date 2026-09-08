"use client";

import { useEffect, useMemo, useRef } from "react";

import { useAnimas } from "@/query/hooks/useAnimas";
import { useSettings } from "@/ui/settings/SettingsProvider";
import { shouldPersistLastActiveAnima } from "@/ui/content-creator/contentCreatorModelPreview";

/** Persist a valid visited Anima as a non-blocking cross-route preference. */
export function useRememberLastActiveAnima(
  routeAnimaId: string | null | undefined,
): void {
  const animasQuery = useAnimas();
  const { userSettings, updateUserSettings } = useSettings();
  const attemptedAnimaIdRef = useRef<string | null>(null);
  const ownedAnimaIds = useMemo(
    () => animasQuery.data?.map((anima) => anima.id) ?? [],
    [animasQuery.data],
  );

  useEffect(() => {
    if (!userSettings || !animasQuery.isSuccess) return;
    if (
      !shouldPersistLastActiveAnima({
        routeAnimaId,
        rememberedAnimaId: userSettings.last_active_anima_id,
        ownedAnimaIds,
      }) ||
      attemptedAnimaIdRef.current === routeAnimaId
    ) {
      return;
    }

    const nextAnimaId = routeAnimaId!;
    attemptedAnimaIdRef.current = nextAnimaId;
    void updateUserSettings({ last_active_anima_id: nextAnimaId }).catch(() => {
      if (attemptedAnimaIdRef.current === nextAnimaId) {
        attemptedAnimaIdRef.current = null;
      }
    });
  }, [
    animasQuery.isSuccess,
    ownedAnimaIds,
    routeAnimaId,
    updateUserSettings,
    userSettings,
  ]);
}

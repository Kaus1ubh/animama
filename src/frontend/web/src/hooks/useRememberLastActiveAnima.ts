"use client";

import { useEffect, useMemo, useState } from "react";

import { useAnimas } from "@/query/hooks/useAnimas";
import { useSettings } from "@/ui/settings/SettingsProvider";
import { createLastActiveAnimaAttempts } from "./lastActiveAnimaAttempts";

/** Persist a valid visited Anima as a non-blocking cross-route preference. */
export function useRememberLastActiveAnima(
  routeAnimaId: string | null | undefined,
): void {
  const animasQuery = useAnimas();
  const { userSettings, updateUserSettings } = useSettings();
  const [attempts] = useState(createLastActiveAnimaAttempts);
  const ownedAnimaIds = useMemo(
    () => animasQuery.data?.map((anima) => anima.id) ?? [],
    [animasQuery.data],
  );

  useEffect(() => {
    if (!userSettings || !animasQuery.isSuccess) return;
    attempts.remember(
      {
        routeAnimaId,
        rememberedAnimaId: userSettings.last_active_anima_id,
        ownedAnimaIds,
      },
      (animaId) => updateUserSettings({ last_active_anima_id: animaId }),
    );
  }, [
    animasQuery.isSuccess,
    attempts,
    ownedAnimaIds,
    routeAnimaId,
    updateUserSettings,
    userSettings,
  ]);
}

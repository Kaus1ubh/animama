import { useCallback, useEffect, useState } from "react";

import type {
  FeaturePackId,
  FeaturePackStatus,
} from "../../../shared/desktop-runtime";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";

/** Only the main embedded renderer can mutate packs. All windows read API capabilities. */
export function useDesktopFeaturePacks() {
  const platform = useRuntimePlatform();
  const desktop = platform.kind === "desktop" ? platform.desktopBridge : null;
  const [packs, setPacks] = useState<FeaturePackStatus[]>([]);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<FeaturePackId | null>(null);
  const bridge = desktop?.featurePacks;

  useEffect(() => {
    if (!bridge || !desktop?.runtime || desktop.windowRole !== "main") return;
    let active = true;
    const unsubscribe = bridge.onProgress((status) => {
      if (active)
        setPacks((current) => [
          ...current.filter((pack) => pack.id !== status.id),
          status,
        ]);
    });
    void desktop.runtime
      .status()
      .then(async (status) => {
        if (!active || status.state === "external") return;
        setAvailable(true);
        const result = await bridge.list();
        if (active) setPacks(result);
      })
      .catch(() => {
        if (active)
          setError(
            "Feature packs are unavailable. Check runtime recovery and retry.",
          );
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge, desktop]);

  const run = useCallback(
    async (operation: "install" | "remove" | "cancel", id: FeaturePackId) => {
      if (!bridge || !available) return;
      if (operation !== "cancel") setPending(id);
      setError(null);
      try {
        await bridge[operation](id);
      } catch {
        // Error details from Electron exceptions can contain paths. Use bounded status codes.
        setError(
          "The pack change could not finish. Review its status below, then retry.",
        );
      } finally {
        if (operation !== "cancel") setPending(null);
        try {
          setPacks(await bridge.list());
        } catch {
          /* Renderer may be reloading. */
        }
      }
    },
    [available, bridge],
  );

  return { available, packs, pending, error, run };
}

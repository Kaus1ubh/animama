import { useCallback, useEffect, useState } from "react";
import type { UpdateStatus } from "../../../shared/desktop-runtime";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";

/** Read bounded update state; only the main embedded window may request a change. */
export function useDesktopUpdates() {
  const platform = useRuntimePlatform();
  const desktop = platform.kind === "desktop" ? platform.desktopBridge : null;
  const bridge = desktop?.windowRole === "main" ? desktop.updates : undefined;
  const [status, setStatus] = useState<UpdateStatus>({ state: "unavailable" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.onStatus((value) => {
      if (active) setStatus(value);
    });
    void bridge
      .status()
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);
  const run = useCallback(
    async (action: "check" | "download" | "restart") => {
      if (!bridge) return;
      setPending(true);
      setError(false);
      try {
        await bridge[action]();
        setStatus(await bridge.status());
      } catch {
        setError(true);
      } finally {
        setPending(false);
      }
    },
    [bridge],
  );
  return { status, pending, error, run };
}

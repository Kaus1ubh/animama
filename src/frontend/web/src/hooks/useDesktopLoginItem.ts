import { useCallback, useEffect, useState } from "react";
import type { LoginItemStatus } from "../../../shared/desktop-runtime";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";

/**
 * Whether the OS opens the packaged desktop app at login. Only the main
 * embedded window may read or change it; elsewhere it is unavailable.
 */
export function useDesktopLoginItem() {
  const platform = useRuntimePlatform();
  const desktop = platform.kind === "desktop" ? platform.desktopBridge : null;
  const bridge = desktop?.windowRole === "main" ? desktop.loginItem : undefined;
  const [status, setStatus] = useState<LoginItemStatus>({ available: false });
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    try {
      setStatus(await bridge.status());
    } catch {
      // Keep the last known state; the setting stays usable.
    }
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    void refresh();
    // The user may allow or remove the login item in the OS settings, then
    // come back to the app.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [bridge, refresh]);

  /** Change the OS setting; rejects when the OS keeps its current state. */
  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!bridge) return;
      setPending(true);
      try {
        setStatus(await bridge.setEnabled(enabled));
      } catch (error) {
        await refresh();
        throw error;
      } finally {
        setPending(false);
      }
    },
    [bridge, refresh],
  );

  return { status, pending, setEnabled };
}

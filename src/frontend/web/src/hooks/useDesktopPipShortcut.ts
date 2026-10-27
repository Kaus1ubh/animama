"use client";

import { useEffect, useRef } from "react";
import { getI18n } from "react-i18next";
import { toast } from "sonner";

import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";

type UseDesktopPipShortcutArgs = {
  /** Whether this window can open the desktop PiP window now. */
  available: boolean;
  onToggle: () => void;
};

/**
 * Lets the desktop PiP shortcut toggle picture-in-picture. While `available`,
 * the main process registers the shortcut and sends its presses here. The
 * shortcut configuration itself comes from the chat's shortcut hook.
 */
export function useDesktopPipShortcut({
  available,
  onToggle,
}: UseDesktopPipShortcutArgs): void {
  const platform = useRuntimePlatform();
  const onToggleRef = useRef(onToggle);

  useEffect(() => {
    onToggleRef.current = onToggle;
  }, [onToggle]);

  useEffect(() => {
    if (!available || !platform.isDesktop || !platform.desktopBridge.shortcuts)
      return;
    const bridge = platform.desktopBridge.shortcuts;
    void bridge.setContext({ pipAvailable: true }).catch((error: unknown) => {
      const t = getI18n().getFixedT(null, "app");
      toast.error(t("shortcuts.unavailable"), {
        description:
          error instanceof Error ? error.message : t("shortcuts.updateFailed"),
      });
    });
    const unsubscribe = bridge.onEvent((event) => {
      if (event.action === "toggle_pip" && event.phase === "down") {
        onToggleRef.current();
      }
    });
    return () => {
      unsubscribe();
      void bridge.setContext({ pipAvailable: false }).catch(() => {
        // The main process drops this window's context when it closes.
      });
    };
  }, [available, platform]);
}

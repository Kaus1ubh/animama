"use client";

import { useEffect, useMemo, useRef } from "react";
import { getI18n } from "react-i18next";
import { toast } from "sonner";

import { resolveDesktopShortcuts } from "@/lib/settings/desktop-shortcuts";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { useSettings } from "@/ui/settings/SettingsProvider";

type UseDesktopPipShortcutArgs = {
  /** Whether this window can open the desktop PiP window now. */
  available: boolean;
  onToggle: () => void;
};

/** Reports a shortcut IPC request the main process refused. */
function reportShortcutError(error: unknown): void {
  const t = getI18n().getFixedT(null, "app");
  toast.error(t("shortcuts.unavailable"), {
    description:
      error instanceof Error ? error.message : t("shortcuts.updateFailed"),
  });
}

/**
 * Lets the desktop PiP shortcut toggle picture-in-picture. While `available`,
 * the main process registers the shortcut and sends its presses here.
 */
export function useDesktopPipShortcut({
  available,
  onToggle,
}: UseDesktopPipShortcutArgs): void {
  const platform = useRuntimePlatform();
  const { userPreferences } = useSettings();
  const desktopShortcutPreferences = userPreferences?.speech?.desktop_shortcuts;
  const shortcuts = useMemo(
    () => resolveDesktopShortcuts(desktopShortcutPreferences, platform.os),
    [desktopShortcutPreferences, platform.os],
  );
  const onToggleRef = useRef(onToggle);

  useEffect(() => {
    onToggleRef.current = onToggle;
  }, [onToggle]);

  // The chat sends the shortcut map too, but it is not mounted in Avatar-only
  // mode, where PiP stays available and a rebinding must still apply.
  useEffect(() => {
    if (!available || !platform.isDesktop || !platform.desktopBridge.shortcuts)
      return;
    void platform.desktopBridge.shortcuts
      .configure({ shortcuts })
      .catch(reportShortcutError);
  }, [available, platform, shortcuts]);

  useEffect(() => {
    if (!available || !platform.isDesktop || !platform.desktopBridge.shortcuts)
      return;
    const bridge = platform.desktopBridge.shortcuts;
    void bridge.setContext({ pipAvailable: true }).catch(reportShortcutError);
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

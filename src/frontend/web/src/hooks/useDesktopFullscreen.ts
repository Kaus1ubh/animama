import { useCallback, useEffect, useState } from "react";

import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";

type AnimamaDesktopFullscreenBridge = NonNullable<
  NonNullable<Window["animamaDesktop"]>["fullscreen"]
>;

export type DesktopFullscreenControls = {
  isAvailable: boolean;
  isFullscreen: boolean;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
};

function runFullscreenRequest(
  request: Promise<boolean>,
  setIsFullscreen: (isFullscreen: boolean) => void,
): void {
  void request
    .then((nextIsFullscreen) => {
      setIsFullscreen(nextIsFullscreen);
    })
    .catch(() => {});
}

export function useDesktopFullscreen(): DesktopFullscreenControls {
  const platform = useRuntimePlatform();
  const desktopFullscreen: AnimamaDesktopFullscreenBridge | null =
    platform.kind === "desktop" && platform.capabilities.nativeFullscreen
      ? (platform.desktopBridge.fullscreen ?? null)
      : null;
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isAvailable = desktopFullscreen !== null;

  useEffect(() => {
    if (!desktopFullscreen) {
      setIsFullscreen(false);
      return;
    }

    let isMounted = true;
    const unsubscribe = desktopFullscreen.onChange((nextIsFullscreen) => {
      setIsFullscreen(nextIsFullscreen);
    });

    void desktopFullscreen
      .isFullscreen()
      .then((nextIsFullscreen) => {
        if (isMounted) {
          setIsFullscreen(nextIsFullscreen);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [desktopFullscreen]);

  const enterFullscreen = useCallback(() => {
    if (!desktopFullscreen) return;
    runFullscreenRequest(desktopFullscreen.enter(), setIsFullscreen);
  }, [desktopFullscreen]);

  const exitFullscreen = useCallback(() => {
    if (!desktopFullscreen) return;
    runFullscreenRequest(desktopFullscreen.exit(), setIsFullscreen);
  }, [desktopFullscreen]);

  return {
    isAvailable,
    isFullscreen,
    enterFullscreen,
    exitFullscreen,
  };
}

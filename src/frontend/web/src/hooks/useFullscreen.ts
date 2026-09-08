"use client";

import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";

import { useDesktopFullscreen } from "@/hooks/useDesktopFullscreen";

type UseFullscreenResult = {
  isFullscreen: boolean;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
};

function useBrowserFullscreen(
  targetRef: RefObject<HTMLElement | null>,
): UseFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleChange = () => {
      setIsFullscreen(document.fullscreenElement === targetRef.current);
    };
    document.addEventListener("fullscreenchange", handleChange);
    handleChange();
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, [targetRef]);

  const enterFullscreen = useCallback(() => {
    const el = targetRef.current;
    if (!el || typeof document === "undefined") return;
    if (document.fullscreenElement) return;
    el.requestFullscreen?.().catch(() => {});
  }, [targetRef]);

  const exitFullscreen = useCallback(() => {
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) return;
    document.exitFullscreen?.().catch(() => {});
  }, []);

  return { isFullscreen, enterFullscreen, exitFullscreen };
}

export function useFullscreen(
  targetRef: RefObject<HTMLElement | null>,
): UseFullscreenResult {
  const desktopFullscreen = useDesktopFullscreen();
  const browserFullscreen = useBrowserFullscreen(targetRef);

  return desktopFullscreen.isAvailable ? desktopFullscreen : browserFullscreen;
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  ANIMA_ROSTER_SHORT_MAX_HEIGHT,
  resolveAnimaRosterLayout,
  type AnimaRosterLayout,
} from "@/lib/animas/anima-roster-layout";

function readViewportLayout(): AnimaRosterLayout {
  if (typeof window === "undefined") return "desktop";
  return resolveAnimaRosterLayout(window.innerWidth, window.innerHeight);
}

/**
 * Tracks only roster breakpoint changes so the live canvas, compact controls,
 * and desktop summary can switch compositions together.
 */
export function useAnimaRosterLayout(): AnimaRosterLayout {
  const [layout, setLayout] = useState<AnimaRosterLayout>(readViewportLayout);

  useEffect(() => {
    const syncLayout = () => {
      setLayout(readViewportLayout());
    };

    window.addEventListener("resize", syncLayout);
    return () => window.removeEventListener("resize", syncLayout);
  }, []);

  return layout;
}

const SHORT_VIEWPORT_QUERY = `(max-height: ${ANIMA_ROSTER_SHORT_MAX_HEIGHT - 1}px)`;

function subscribeToShortViewport(onChange: () => void): () => void {
  const media = window.matchMedia(SHORT_VIEWPORT_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Whether the viewport is short enough to need the close stage camera. */
export function useShortAnimaViewport(): boolean {
  return useSyncExternalStore(
    subscribeToShortViewport,
    () => window.matchMedia(SHORT_VIEWPORT_QUERY).matches,
    () => false,
  );
}

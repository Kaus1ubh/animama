"use client";

import { useEffect, useState } from "react";

import {
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

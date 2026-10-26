import { useEffect } from "react";

/** Root attribute that pauses every shine border (see `globals.css`). */
export const SHINE_PAUSED_ATTRIBUTE = "data-animama-shine-paused";

/**
 * Pauses the composer's decorative shine border while its window is not in
 * use: when the window loses focus, or while PiP is open in front of it. The
 * shine repaints the window every display frame, which with PiP open is most
 * of the main window's cost.
 */
export function usePauseShineWhileInactive(pipActive: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.toggleAttribute(
        SHINE_PAUSED_ATTRIBUTE,
        pipActive || !document.hasFocus(),
      );
    };
    apply();
    window.addEventListener("focus", apply);
    window.addEventListener("blur", apply);
    return () => {
      window.removeEventListener("focus", apply);
      window.removeEventListener("blur", apply);
      root.removeAttribute(SHINE_PAUSED_ATTRIBUTE);
    };
  }, [pipActive]);
}

export type AnimaRosterLayout = "phone" | "tablet" | "desktop";

export const ANIMA_ROSTER_TABLET_MIN_WIDTH = 768;
export const ANIMA_ROSTER_DESKTOP_MIN_WIDTH = 1280;

/**
 * Resolves the roster composition from viewport width using the same md and xl
 * breakpoints as the surrounding app shell.
 */
export function resolveAnimaRosterLayout(
  viewportWidth: number,
): AnimaRosterLayout {
  if (viewportWidth >= ANIMA_ROSTER_DESKTOP_MIN_WIDTH) return "desktop";
  if (viewportWidth >= ANIMA_ROSTER_TABLET_MIN_WIDTH) return "tablet";
  return "phone";
}

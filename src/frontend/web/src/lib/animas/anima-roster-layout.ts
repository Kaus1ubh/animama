export type AnimaRosterLayout = "phone" | "tablet" | "desktop";

export const ANIMA_ROSTER_TABLET_MIN_WIDTH = 768;
export const ANIMA_ROSTER_DESKTOP_MIN_WIDTH = 1280;
/** Below this height the tablet stage would fill the screen (landscape phones). */
export const ANIMA_ROSTER_SHORT_MAX_HEIGHT = 500;

/**
 * Resolves the roster composition from viewport width using the same md and xl
 * breakpoints as the surrounding app shell. Short viewports below desktop width
 * use the phone composition, whose stage opens on demand.
 */
export function resolveAnimaRosterLayout(
  viewportWidth: number,
  viewportHeight = Number.POSITIVE_INFINITY,
): AnimaRosterLayout {
  if (viewportWidth >= ANIMA_ROSTER_DESKTOP_MIN_WIDTH) return "desktop";
  if (viewportHeight < ANIMA_ROSTER_SHORT_MAX_HEIGHT) return "phone";
  if (viewportWidth >= ANIMA_ROSTER_TABLET_MIN_WIDTH) return "tablet";
  return "phone";
}

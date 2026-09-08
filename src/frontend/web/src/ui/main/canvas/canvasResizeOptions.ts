/**
 * Keep React Three Fiber synchronized with animated parent geometry.
 *
 * R3F's default measurement options debounce ResizeObserver notifications via
 * the scroll callback. During an AppShell width transition that leaves the
 * renderer at its previous size until the animation ends, which visibly
 * overshoots the centered Avatar before the Canvas snaps to its final width.
 */
export const CONTINUOUS_CANVAS_RESIZE = {
  debounce: {
    scroll: 0,
    resize: 0,
  },
} as const;

import type { IntroPhase } from "./intro";

/*
 * The contract between the 3D stage (`stage.ts`) and the page overlay
 * (`overlay.tsx`): the stage publishes what is showing, and the overlay asks
 * it to play clips and switch Avatars.
 */

export type StageState = {
  /** Whether the Avatar has loaded. */
  ready: boolean;
  /** Index of the stop the page treats as active, or -1 before the first frame. */
  active: number;
  /** The clip playing at a stop (stop and clip index), or null between clips. */
  playing: { stop: number; clip: number } | null;
  /** Problems resolving sources, shown in the HUD. */
  problems: string[];
  /**
   * The hero entrance's progress.
   */
  intro: IntroPhase;
  /**
   * Whether the hero's text, the progress thread and the stop framing are
   * shown: from a second into her wave (at once when there is no entrance).
   */
  revealed: boolean;
  /** The Avatar on stage (a `STAGE_AVATARS` id). */
  avatar: string;
  /** The Avatar being loaded to replace it, or null. */
  avatarLoading: string | null;
};

export type StageController = {
  getState(): StageState;
  subscribe(listener: () => void): () => void;
  /** Scroll the page to a stop. */
  scrollToStop(index: number): void;
  /** Load another of `STAGE_AVATARS` in place of the one on stage. */
  selectAvatar(id: string): void;
  /** Play one of a stop's clips now; a cycling stop continues from it. */
  playClip(stop: number, clip: number): void;
  /**
   * Where the hero's text ends, in pixels from the top of the viewport; the
   * hero framing keeps her head below it.
   */
  setHeroTextBottom(px: number): void;
};

/** A minimal observable store for `useSyncExternalStore`. */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T>) {
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

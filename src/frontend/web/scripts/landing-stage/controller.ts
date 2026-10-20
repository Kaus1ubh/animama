import type {
  CreatorLayerId,
  CreatorPaletteId,
  CreatorParticleId,
} from "./stops";

/*
 * The contract between the 3D stage (`stage.ts`) and the page overlay
 * (`overlay.tsx`): the stage publishes what is showing, and the overlay asks
 * it to play clips and build the creator demo's effects.
 */

/** What the creator demo has switched on. */
export type CreatorState = {
  layers: Record<CreatorLayerId, boolean>;
  palette: CreatorPaletteId;
  particle: CreatorParticleId | null;
};

export type StageState = {
  /** Whether the Avatar has loaded. */
  ready: boolean;
  /** Index of the stop the page treats as active, or -1 before the first frame. */
  active: number;
  /** The clip playing at a stop (stop and clip index), or null between clips. */
  playing: { stop: number; clip: number } | null;
  /** Problems resolving sources, shown in the HUD. */
  problems: string[];
};

export type StageController = {
  getState(): StageState;
  subscribe(listener: () => void): () => void;
  /** Scroll the page to a stop. */
  scrollToStop(index: number): void;
  /** Play one of a stop's clips now; a cycling stop continues from it. */
  playClip(stop: number, clip: number): void;
  /** Rebuild the creator demo's Scene and Particle Effects. */
  setCreator(state: CreatorState): void;
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

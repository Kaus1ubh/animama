import { PLAIN_BACKDROP, STAGE_STOPS, type StageStop } from "./stops";

/*
 * What the live 3D stage (`stage.ts`) and its fallback of stills
 * (`fallback.ts`) share: the address's switches, the scroll position between
 * stops and the stops' backdrops.
 */

declare global {
  interface Window {
    /** The page's state, for browser checks. */
    landingStage: {
      ready: boolean;
      error: string | null;
      stop: () => string | null;
      problems: string[];
      /** Why stills stand in for the live stage (`main.ts`), if they do. */
      fallback?: string;
      /**
       * The renderer's live geometries, textures and shader programs
       * (development only).
       */
      renderInfo?: () => {
        geometries: number;
        textures: number;
        programs: number;
      };
    };
  }
}

export const params = new URLSearchParams(location.search);
/** A development-only switch's value (null in a production build). */
export const devParam = (name: string) =>
  import.meta.env.DEV ? params.get(name) : null;
export const reducedMotion = matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
/** The stop `?stop=<id>` opens at, or -1. */
export const openingStop = STAGE_STOPS.findIndex(
  ({ id }) => id === params.get("stop"),
);

/** Share of each scroll segment held at its stops before the camera moves. */
const HOLD = 0.22;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
/** Ease in and out with zero velocity and acceleration at both ends. */
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Where scrolling has reached: the segment's first stop, the eased blend
 * toward the next one, and the stop the page treats as active.
 */
export function scrollPosition() {
  const last = STAGE_STOPS.length - 1;
  const raw = clamp(window.scrollY / Math.max(1, window.innerHeight), 0, last);
  const from = Math.min(Math.floor(raw), last - 1);
  const local = raw - from;
  const blend = smootherstep(clamp((local - HOLD) / (1 - 2 * HOLD), 0, 1));
  return { from, blend, active: local < 0.5 ? from : from + 1 };
}

export function scrollToStop(index: number) {
  window.scrollTo({
    top: index * window.innerHeight,
    behavior: reducedMotion ? "auto" : "smooth",
  });
}

/**
 * A stop's backdrop: plain cream behind the light stops unless `?washes`
 * asks for their pastel gradients; the night sky always keeps its own.
 */
export function stopBackdrop(stop: StageStop) {
  return stop.dusk || devParam("washes") !== null
    ? stop.backdrop
    : PLAIN_BACKDROP;
}

/**
 * One backdrop layer per stop in `container`; the returned function
 * cross-fades them for a scroll position (`from`, `blend`).
 */
export function createBackdrops(container: HTMLElement) {
  const layers = STAGE_STOPS.map((stop) => {
    const layer = document.createElement("div");
    layer.className = "backdrop-layer";
    layer.style.background = stopBackdrop(stop);
    container.append(layer);
    return layer;
  });
  return (from: number, blend: number) =>
    layers.forEach((layer, index) => {
      layer.style.opacity = String(
        index === from ? 1 - blend : index === from + 1 ? blend : 0,
      );
    });
}

import { createContext, useContext, useEffect } from "react";

/**
 * How often paced Avatar scenes render. Displays refresh at 60-144 Hz, but the
 * Avatar looks the same above 60 fps, and an idle Avatar (breathing, blinking,
 * hair sway) looks nearly the same at 30. Each frame costs CPU in the renderer
 * and GPU process, so rendering at these rates instead of the display rate
 * roughly halves the cost on a 120 Hz display, and halves it again while idle.
 */
export const ACTIVE_SCENE_FPS = 60;
export const IDLE_SCENE_FPS = 30;

/** Pointer or keyboard input keeps the full rate this long afterwards. */
export const SCENE_INPUT_ACTIVE_MS = 1500;

/**
 * Display frame timestamps jitter by a fraction of a millisecond, so a frame
 * that arrives just short of the interval still counts as due.
 */
const FRAME_TOLERANCE_MS = 1;

/**
 * What the scene's contents need, written by the Avatar actor and input
 * listeners and read by the frame pacer every display frame. A plain mutable
 * object: it changes every frame and must not re-render React.
 */
export type SceneFrameDemand = {
  /**
   * The Avatar actor reports an Avatar with nothing beyond its idle loop.
   * Stays false for scenes whose actor does not report, so they keep the
   * full rate.
   */
  avatarIdle: boolean;
  /** `performance.now()` of the latest pointer, wheel or key input. */
  lastInputMs: number;
};

export function createSceneFrameDemand(): SceneFrameDemand {
  return { avatarIdle: false, lastInputMs: Number.NEGATIVE_INFINITY };
}

/** The scene's frame demand; null outside a paced scene. */
export const SceneFrameDemandContext = createContext<SceneFrameDemand | null>(
  null,
);

/**
 * The frame demand of the paced scene around an Avatar actor, or null outside
 * one. The actor sets `avatarIdle` after each update; unmounting restores the
 * full rate.
 */
export function useSceneFrameDemand(): SceneFrameDemand | null {
  const demand = useContext(SceneFrameDemandContext);
  useEffect(() => {
    if (!demand) return;
    return () => {
      demand.avatarIdle = false;
    };
  }, [demand]);
  return demand;
}

/**
 * Canvases other than chat and PiP render at most 1.5× device pixels: on a
 * Retina display that is 44% fewer pixels and about 230 MB less GPU memory
 * for a full-window canvas, with 4× MSAA kept so outlines stay intact. Chat
 * and PiP keep 2×.
 */
export const PREVIEW_CANVAS_DPR: [number, number] = [1, 1.5];

/** The frame rate the scene needs now. */
export function sceneTargetFps(
  demand: SceneFrameDemand,
  nowMs: number,
): number {
  return demand.avatarIdle && nowMs - demand.lastInputMs > SCENE_INPUT_ACTIVE_MS
    ? IDLE_SCENE_FPS
    : ACTIVE_SCENE_FPS;
}

/**
 * Decide whether the display frame at `nowMs` should render at `fps`, given
 * the schedule `lastFrameMs`. Returns the new schedule when it renders, or
 * null to skip. The schedule advances by whole intervals, so a 144 Hz display
 * capped at 60 fps alternates 2- and 3-frame gaps and averages 60, and a long
 * pause restarts the schedule instead of rendering a burst to catch up.
 */
export function nextSceneFrame(
  nowMs: number,
  lastFrameMs: number,
  fps: number,
): number | null {
  const intervalMs = 1000 / fps;
  const elapsedMs = nowMs - lastFrameMs;
  if (elapsedMs < intervalMs - FRAME_TOLERANCE_MS) return null;
  if (elapsedMs >= intervalMs * 2) return nowMs;
  return lastFrameMs + intervalMs;
}

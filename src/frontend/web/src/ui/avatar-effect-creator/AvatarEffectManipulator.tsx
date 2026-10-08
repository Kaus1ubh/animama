import { useFrame } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import type { Avatar } from "@/lib/avatar";
import type { AvatarEffectEditorAttachment } from "@/lib/avatar/vfx/editor";
import type { AvatarVFXManipulationFrame } from "@/lib/avatar/vfx/placement-guide-types";
import {
  AvatarEffectDragSession,
  type AvatarEffectDragTarget,
  type AvatarEffectDragView,
} from "./avatarEffectDrag";
import {
  arrowDirection,
  hitTestManipulation,
  nudgePixels,
  screenPlacements,
  type ManipulationHit,
  type ScreenPlacement,
  type ScreenPoint,
} from "./directManipulation";

/** Handles are slate, apart from the guides' pink (animated art) and blue (anchors). */
const HANDLE = "#0f172a";
const HANDLE_SIZE = 8;

/** State shared by the canvas-side tracker and the DOM pointer handlers. */
export type AvatarEffectManipulationState = {
  view: (AvatarEffectDragView & { element: HTMLElement }) | null;
  frame: AvatarVFXManipulationFrame | null;
  placements: ScreenPlacement[];
  /** The handle under the pointer or being dragged, for highlighting. */
  active: ManipulationHit | null;
};

export function createAvatarEffectManipulationState(): AvatarEffectManipulationState {
  return { view: null, frame: null, placements: [], active: null };
}

/**
 * Inside the preview Canvas: find where the applied art is drawn this frame
 * and draw its move, scale and rotate handles on an overlay canvas. Reads the
 * controller only; it owns no scene objects.
 */
export function AvatarEffectHandleRenderer({
  avatar,
  appliedId,
  enabled,
  canvasRef,
  stateRef,
}: {
  avatar: Avatar | null;
  appliedId: string | null;
  enabled: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  stateRef: RefObject<AvatarEffectManipulationState>;
}) {
  useFrame(({ camera, size, gl }) => {
    const state = stateRef.current;
    state.view = {
      camera,
      width: size.width,
      height: size.height,
      element: gl.domElement,
    };
    const frame =
      enabled && appliedId
        ? (avatar?.vfxController?.getManipulationFrame(appliedId, camera) ??
          null)
        : null;
    state.frame = frame;
    state.placements = frame
      ? screenPlacements(frame, camera, size.width, size.height)
      : [];
    const canvas = canvasRef.current;
    if (canvas)
      drawManipulationHandles(
        canvas,
        state.placements,
        state.active,
        size.width,
        size.height,
        gl.getPixelRatio(),
      );
  });
  return null;
}

/** Outline, corner (scale) and round (rotate) handles for each copy of the art. */
export function drawManipulationHandles(
  canvas: HTMLCanvasElement,
  placements: readonly ScreenPlacement[],
  active: ManipulationHit | null,
  width: number,
  height: number,
  pixelRatio: number,
): void {
  const ratio = Math.min(2, pixelRatio);
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  canvas.dataset.handleCount = String(placements.length);
  // Handle positions in CSS pixels, for browser journeys and diagnostics.
  const handles = JSON.stringify(
    placements.map((placement) => ({
      label: placement.label,
      center: roundPoint(placement.center),
      rotate: roundPoint(placement.rotateHandle),
      corners: placement.corners.map(roundPoint),
    })),
  );
  if (canvas.dataset.handles !== handles) canvas.dataset.handles = handles;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  for (const placement of placements) {
    const highlighted = active?.placement.index === placement.index;
    const [topLeft, topRight] = placement.corners;
    const top = {
      x: (topLeft.x + topRight.x) / 2,
      y: (topLeft.y + topRight.y) / 2,
    };
    ctx.save();
    ctx.lineJoin = "round";
    ctx.beginPath();
    placement.corners.forEach((corner, index) =>
      index ? ctx.lineTo(corner.x, corner.y) : ctx.moveTo(corner.x, corner.y),
    );
    ctx.closePath();
    ctx.setLineDash(highlighted ? [] : [5, 4]);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = HANDLE;
    ctx.lineWidth = highlighted ? 2 : 1.25;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(placement.rotateHandle.x, placement.rotateHandle.y);
    ctx.strokeStyle = HANDLE;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = HANDLE;
    ctx.lineWidth = 1.5;
    for (const corner of placement.corners) {
      ctx.fillRect(
        corner.x - HANDLE_SIZE / 2,
        corner.y - HANDLE_SIZE / 2,
        HANDLE_SIZE,
        HANDLE_SIZE,
      );
      ctx.strokeRect(
        corner.x - HANDLE_SIZE / 2,
        corner.y - HANDLE_SIZE / 2,
        HANDLE_SIZE,
        HANDLE_SIZE,
      );
    }
    ctx.beginPath();
    ctx.arc(
      placement.rotateHandle.x,
      placement.rotateHandle.y,
      HANDLE_SIZE / 2 + 1,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function roundPoint(point: ScreenPoint): ScreenPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

const CURSORS: Record<ManipulationHit["mode"], string> = {
  move: "move",
  scale: "nwse-resize",
  rotate: "grab",
};

/**
 * Pointer and keyboard handling for direct manipulation on the preview
 * container. A press on the art or a handle is captured before the orbit
 * controls see it; anywhere else the camera orbits as usual.
 */
export function useAvatarEffectManipulation({
  containerRef,
  stateRef,
  enabled,
  attachment,
  target,
}: {
  containerRef: RefObject<HTMLElement | null>;
  stateRef: RefObject<AvatarEffectManipulationState>;
  enabled: boolean;
  attachment: AvatarEffectEditorAttachment;
  target: AvatarEffectDragTarget;
}): { onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void } {
  const attachmentRef = useRef(attachment);
  attachmentRef.current = attachment;
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;
    let session: AvatarEffectDragSession | null = null;
    let pointerId: number | null = null;
    const local = (event: PointerEvent): ScreenPoint | null => {
      const element = stateRef.current.view?.element;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const finish = () => {
      session?.end();
      session = null;
      if (pointerId !== null && container.hasPointerCapture(pointerId))
        container.releasePointerCapture(pointerId);
      pointerId = null;
      stateRef.current.active = null;
      container.style.cursor = "";
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || session) return;
      const state = stateRef.current;
      const point = local(event);
      if (!point || !state.view || !state.frame) return;
      const hit = hitTestManipulation(state.placements, point);
      if (!hit) return;
      const started = AvatarEffectDragSession.begin({
        hit,
        pointer: point,
        frame: state.frame,
        attachment: attachmentRef.current,
        view: state.view,
        target: {
          beginGroup: () => targetRef.current.beginGroup(),
          endGroup: () => targetRef.current.endGroup(),
          apply: (patch) => targetRef.current.apply(patch),
        },
      });
      if (!started) return;
      // Keep the orbit controls from seeing this press.
      event.stopPropagation();
      event.preventDefault();
      session = started;
      pointerId = event.pointerId;
      container.setPointerCapture(event.pointerId);
      container.focus({ preventScroll: true });
      state.active = hit;
      container.style.cursor = CURSORS[hit.mode];
    };
    const onPointerMove = (event: PointerEvent) => {
      const state = stateRef.current;
      const point = local(event);
      if (!point) return;
      if (session && state.view) {
        event.stopPropagation();
        session.move(point, state.view);
        return;
      }
      const hover = hitTestManipulation(state.placements, point);
      state.active = hover;
      container.style.cursor = hover ? CURSORS[hover.mode] : "";
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!session || event.pointerId !== pointerId) return;
      event.stopPropagation();
      finish();
    };
    container.addEventListener("pointerdown", onPointerDown, true);
    container.addEventListener("pointermove", onPointerMove, true);
    container.addEventListener("pointerup", onPointerUp, true);
    container.addEventListener("pointercancel", onPointerUp, true);
    container.addEventListener("lostpointercapture", finish);
    return () => {
      finish();
      container.removeEventListener("pointerdown", onPointerDown, true);
      container.removeEventListener("pointermove", onPointerMove, true);
      container.removeEventListener("pointerup", onPointerUp, true);
      container.removeEventListener("pointercancel", onPointerUp, true);
      container.removeEventListener("lostpointercapture", finish);
    };
  }, [containerRef, enabled, stateRef]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const direction = arrowDirection(event.key);
      const state = stateRef.current;
      if (!enabled || !direction || !state.view || !state.frame) return;
      const placement = state.placements[0];
      if (!placement) return;
      event.preventDefault();
      // A nudge is a short drag from the art's centre: one undo step that
      // moves the art the same way on screen whatever its attachment.
      const distance = nudgePixels(event.shiftKey);
      const nudge = AvatarEffectDragSession.begin({
        hit: { mode: "move", placement },
        pointer: placement.center,
        frame: state.frame,
        attachment: attachmentRef.current,
        view: state.view,
        target: targetRef.current,
      });
      nudge?.move(
        {
          x: placement.center.x + direction.x * distance,
          y: placement.center.y + direction.y * distance,
        },
        state.view,
      );
      nudge?.end();
    },
    [enabled, stateRef],
  );
  return { onKeyDown };
}

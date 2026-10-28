/**
 * Frame-rate caps on Avatar canvases. An Avatar whose frames cost more than
 * its canvas can draw at the full rate (Automatic's lilToon cap,
 * `lilToonGpuCheck.ts`) caps the canvas it draws on, and that canvas's frame
 * pacer (`SceneFramePacer`) renders at most that often. Keyed by the canvas
 * element every Avatar is constructed with, so the cap reaches chat, Picture
 * in Picture, previews and creators alike; a canvas showing several Avatars
 * uses the lowest cap.
 */

const caps = new WeakMap<Element, Map<object, number>>();

/** Set or clear (`fps` null) one owner's cap on a canvas. */
export function setCanvasFrameCap(
  canvas: Element,
  owner: object,
  fps: number | null,
): void {
  let owners = caps.get(canvas);
  if (fps === null) {
    owners?.delete(owner);
    if (owners?.size === 0) caps.delete(canvas);
    return;
  }
  if (!owners) caps.set(canvas, (owners = new Map()));
  owners.set(owner, fps);
}

/** The lowest cap on a canvas, or null when nothing caps it. */
export function canvasFrameCap(
  canvas: Element | null | undefined,
): number | null {
  const owners = canvas ? caps.get(canvas) : undefined;
  if (!owners) return null;
  let lowest: number | null = null;
  for (const fps of owners.values())
    if (lowest === null || fps < lowest) lowest = fps;
  return lowest;
}

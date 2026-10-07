import { Vector3, type Camera, type Object3D } from "three";
import type { AvatarFaceLandmarkVector } from "@/lib/avatar/vfx/landmark-types";
import type { AvatarVFXPlacementGuides } from "@/lib/avatar/vfx/placement-guide-types";

type Point = { x: number; y: number };
const REFERENCE = "#0284c7";
const ARTWORK = "#db2777";
/**
 * A guide label's offset below its reference point, in CSS pixels: clear of
 * the bottom corner handles of art drawn at the minimum handle box.
 */
const GUIDE_LABEL_OFFSET = 30;
/** …and its least gap below the art's lowest point, past the corner handles. */
const GUIDE_LABEL_ART_GAP = 20;

/** Project a face-local point through the current model and camera transforms. */
export function projectPlacementGuidePoint(
  point: AvatarFaceLandmarkVector,
  anchor: Object3D,
  camera: Camera,
  width: number,
  height: number,
): Point | null {
  anchor.updateWorldMatrix(true, false);
  const projected = new Vector3(point.x, point.y, point.z)
    .applyMatrix4(anchor.matrixWorld)
    .project(camera);
  if (
    ![projected.x, projected.y, projected.z].every(Number.isFinite) ||
    projected.z < -1 ||
    projected.z > 1
  )
    return null;
  return {
    x: ((projected.x + 1) * width) / 2,
    y: ((1 - projected.y) * height) / 2,
  };
}

/** A read-only screen overlay: no materials, render targets or model resources are owned here. */
export function drawPlacementGuides(
  canvas: HTMLCanvasElement,
  guides: AvatarVFXPlacementGuides | null,
  camera: Camera,
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
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const labels = guides?.spatial.map((guide) => guide.label) ?? [];
  const messages = guides?.messages ?? [];
  const description = ["Placement guides", ...labels, ...messages].join(". ");
  if (canvas.getAttribute("aria-label") !== description)
    canvas.setAttribute("aria-label", description);
  canvas.dataset.guideCount = String(labels.length);
  canvas.dataset.artworkCount = String(
    guides?.spatial.filter((guide) => guide.artwork.length).length ?? 0,
  );
  if (!guides?.anchor) {
    if (messages[0])
      badge(ctx, messages[0], width / 2, Math.max(90, height * 0.18), width);
    return;
  }
  const anchor = guides.anchor;
  const project = (point: AvatarFaceLandmarkVector) =>
    projectPlacementGuidePoint(point, anchor, camera, width, height);
  ctx.save();
  ctx.lineJoin = "round";
  const box = guides.faceBounds;
  if (box) {
    const corners = [
      { x: box.min.x, y: box.min.y, z: box.min.z },
      { x: box.max.x, y: box.min.y, z: box.min.z },
      { x: box.max.x, y: box.max.y, z: box.min.z },
      { x: box.min.x, y: box.max.y, z: box.min.z },
      { x: box.min.x, y: box.min.y, z: box.max.z },
      { x: box.max.x, y: box.min.y, z: box.max.z },
      { x: box.max.x, y: box.max.y, z: box.max.z },
      { x: box.min.x, y: box.max.y, z: box.max.z },
    ].map(project);
    ctx.globalAlpha = 0.55;
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ]) {
      if (corners[a] && corners[b])
        stroke(ctx, [corners[a]!, corners[b]!], REFERENCE, true);
    }
    ctx.globalAlpha = 1;
  }
  for (const guide of guides.spatial) {
    const reference = project(guide.reference);
    const artwork = guide.artwork.map(project);
    let artBottom = -Infinity;
    if (artwork.length && artwork.every((point) => point !== null)) {
      const points = artwork as Point[];
      stroke(ctx, [...points, points[0]], ARTWORK);
      const center = points.reduce(
        (sum, point) => ({
          x: sum.x + point.x / points.length,
          y: sum.y + point.y / points.length,
        }),
        { x: 0, y: 0 },
      );
      if (reference) stroke(ctx, [reference, center], REFERENCE, true);
      artBottom = Math.max(...points.map((point) => point.y));
    }
    if (!reference) continue;
    ctx.beginPath();
    ctx.arc(reference.x, reference.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
    ctx.strokeStyle = REFERENCE;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.stroke();
    // Below the point and the art: the art's rotate handle sits above it.
    badge(
      ctx,
      guide.label + (guide.source === "fallback" ? " · estimated" : ""),
      reference.x,
      Math.max(
        reference.y + GUIDE_LABEL_OFFSET,
        artBottom + GUIDE_LABEL_ART_GAP,
      ),
      width,
    );
  }
  ctx.restore();
  // Keep metadata in one short, stable line rather than covering the face with diagnostics.
  if (messages[0])
    badge(ctx, messages[0], width / 2, Math.max(90, height * 0.18), width);
}

function stroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  dashed = false,
) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.setLineDash(dashed ? [4, 4] : []);
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = dashed ? 3 : 4;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = dashed ? 1 : 2;
  ctx.stroke();
  ctx.setLineDash([]);
}

function badge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
) {
  ctx.font = "12px system-ui, sans-serif";
  const size = Math.min(width - 24, ctx.measureText(text).width + 14);
  const left = Math.max(12, Math.min(width - size - 12, x - size / 2));
  const top = Math.max(12, y - 10);
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.fillRect(left, top, size, 20);
  ctx.fillStyle = "#334155";
  ctx.fillText(text, left + 7, top + 14, size - 14);
}

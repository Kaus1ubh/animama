import type {
  AvatarVFXGuideSurface,
  AvatarVFXUvGuide,
} from "@/lib/avatar/vfx/placement-guide-types";

const GUIDE_COLORS = {
  reference: "#0284c7",
  artwork: "#db2777",
  flatten: "#b45309",
  sample: "#15803d",
} satisfies Record<AvatarVFXUvGuide["kind"], string>;

/** Draw a borrowed compositor surface; projection coordinates already use source-image orientation. */
export function drawAvatarEffectUvSurface(
  canvas: HTMLCanvasElement,
  surface: AvatarVFXGuideSurface,
  showCoverage: boolean,
): void {
  if (surface.width <= 0 || surface.height <= 0) return;
  const ratio = Math.min(1, 768 / Math.max(surface.width, surface.height));
  const width = Math.max(1, Math.round(surface.width * ratio));
  const height = Math.max(1, Math.round(surface.height * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.drawImage(surface.image, 0, 0, width, height);
  // Keep linework and labels readable when the source texture is scaled into the popover.
  const displayScale = width / (canvas.clientWidth || width);
  for (const guide of surface.guides) {
    if (
      !showCoverage &&
      (guide.kind === "flatten" || guide.kind === "sample")
    ) {
      continue;
    }
    if (guide.points.length === 0) continue;
    context.save();
    context.strokeStyle = GUIDE_COLORS[guide.kind];
    context.fillStyle = GUIDE_COLORS[guide.kind];
    context.lineWidth = (guide.kind === "artwork" ? 2.5 : 1.5) * displayScale;
    context.setLineDash(
      guide.kind === "reference" || guide.kind === "sample"
        ? [4 * displayScale, 4 * displayScale]
        : [],
    );
    context.beginPath();
    if (guide.shape === "ellipse") {
      const xs = guide.points.map((point) => point.x * width);
      const ys = guide.points.map((point) => point.y * height);
      const x1 = Math.min(...xs);
      const x2 = Math.max(...xs);
      const y1 = Math.min(...ys);
      const y2 = Math.max(...ys);
      context.ellipse(
        (x1 + x2) / 2,
        (y1 + y2) / 2,
        (x2 - x1) / 2,
        (y2 - y1) / 2,
        0,
        0,
        Math.PI * 2,
      );
    } else {
      const [first, ...rest] = guide.points;
      context.moveTo(first.x * width, first.y * height);
      for (const point of rest)
        context.lineTo(point.x * width, point.y * height);
      context.closePath();
    }
    context.stroke();
    context.setLineDash([]);
    if (guide.pivot) {
      const x = guide.pivot.x * width;
      const y = guide.pivot.y * height;
      const radius = 4 * displayScale;
      context.beginPath();
      context.moveTo(x, y - radius);
      context.lineTo(x + radius, y);
      context.lineTo(x, y + radius);
      context.lineTo(x - radius, y);
      context.closePath();
      context.fill();
      context.strokeStyle = "#ffffff";
      context.stroke();
    }
    // A white outline keeps concise labels legible on either light or dark textures.
    context.font = `${12 * displayScale}px system-ui, sans-serif`;
    context.textBaseline = "top";
    const labelWidth = context.measureText(guide.label).width;
    const x = Math.max(
      3 * displayScale,
      Math.min(
        width - labelWidth - 3 * displayScale,
        guide.points[0].x * width,
      ),
    );
    const y = Math.max(
      3 * displayScale,
      Math.min(
        height - 15 * displayScale,
        guide.points[0].y * height + 4 * displayScale,
      ),
    );
    context.strokeStyle = "#ffffff";
    context.lineWidth = 3 * displayScale;
    context.strokeText(guide.label, x, y);
    context.fillText(guide.label, x, y);
    context.restore();
  }
}

export type UvPreviewFrameScheduler = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (handle: number) => void;
};

/** Own only the preview frame loop. The returned cleanup never alters borrowed textures. */
export function startAvatarEffectUvPreview(
  canvas: HTMLCanvasElement,
  readSurface: () => AvatarVFXGuideSurface | undefined,
  showCoverage: boolean,
  scheduler: UvPreviewFrameScheduler,
): () => void {
  let stopped = false;
  let lastDraw = -Infinity;
  let handle = 0;
  const frame: FrameRequestCallback = (time) => {
    if (stopped) return;
    if (time - lastDraw >= 1000 / 30) {
      lastDraw = time;
      const surface = readSurface();
      if (surface) drawAvatarEffectUvSurface(canvas, surface, showCoverage);
      else
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
    handle = scheduler.request(frame);
  };
  handle = scheduler.request(frame);
  return () => {
    stopped = true;
    scheduler.cancel(handle);
  };
}

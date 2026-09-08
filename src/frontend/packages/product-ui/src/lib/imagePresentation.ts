import type { PyRuntimeImagePresentation } from "@animama/runtime-contracts/api-types";

export const MIN_RUNTIME_IMAGE_ZOOM = 1;
export const MAX_RUNTIME_IMAGE_ZOOM = 4;

export type RuntimeImagePresentation = {
  fit: "cover" | "contain";
  focal_x: number;
  focal_y: number;
  zoom: number;
};

export type RuntimeImageLayout = {
  height: number;
  left: number;
  top: number;
  width: number;
};

function boundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** Normalize current image settings into the shared presentation contract. */
export function normalizeRuntimeImagePresentation(
  value:
    | Record<string, unknown>
    | PyRuntimeImagePresentation
    | null
    | undefined,
): RuntimeImagePresentation {
  const config = value as Record<string, unknown> | null | undefined;
  return {
    fit: config?.fit === "contain" ? "contain" : "cover",
    focal_x: boundedNumber(config?.focal_x, 0.5, 0, 1),
    focal_y: boundedNumber(config?.focal_y, 0.5, 0, 1),
    zoom: boundedNumber(
      config?.zoom,
      MIN_RUNTIME_IMAGE_ZOOM,
      MIN_RUNTIME_IMAGE_ZOOM,
      MAX_RUNTIME_IMAGE_ZOOM,
    ),
  };
}

/** Merge crop fields without discarding labels or future slot configuration. */
export function runtimeImageConfig(
  current: Record<string, unknown> | null | undefined,
  presentation: RuntimeImagePresentation,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(current ?? {}),
    fit: presentation.fit,
    focal_x: presentation.focal_x,
    focal_y: presentation.focal_y,
    zoom: presentation.zoom,
  };
  delete next.position;
  return next;
}

/** Translate an editor drag into normalized focal coordinates. */
export function applyRuntimeImageDrag({
  presentation,
  frameWidth,
  frameHeight,
  deltaX,
  deltaY,
}: {
  presentation: RuntimeImagePresentation;
  frameWidth: number;
  frameHeight: number;
  deltaX: number;
  deltaY: number;
}): RuntimeImagePresentation {
  const width = Math.max(1, frameWidth * presentation.zoom);
  const height = Math.max(1, frameHeight * presentation.zoom);
  return {
    ...presentation,
    focal_x: boundedNumber(presentation.focal_x - deltaX / width, 0.5, 0, 1),
    focal_y: boundedNumber(presentation.focal_y - deltaY / height, 0.5, 0, 1),
  };
}

/**
 * Resolve the source image beyond a target frame, matching object-fit and
 * object-position while leaving the excluded pixels available to an editor.
 */
export function getRuntimeImageLayout({
  presentation,
  frameWidth,
  frameHeight,
  imageWidth,
  imageHeight,
}: {
  presentation: RuntimeImagePresentation;
  frameWidth: number;
  frameHeight: number;
  imageWidth: number;
  imageHeight: number;
}): RuntimeImageLayout | null {
  if (
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return null;
  }

  const widthScale = frameWidth / imageWidth;
  const heightScale = frameHeight / imageHeight;
  const fitScale =
    presentation.fit === "contain"
      ? Math.min(widthScale, heightScale)
      : Math.max(widthScale, heightScale);
  const scale = fitScale * presentation.zoom;
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    width,
    height,
    left: (frameWidth - width) * presentation.focal_x,
    top: (frameHeight - height) * presentation.focal_y,
  };
}

/** Drag an explicitly laid-out editor image while keeping its focal point bounded. */
export function applyRuntimeImageLayoutDrag({
  presentation,
  frameWidth,
  frameHeight,
  imageWidth,
  imageHeight,
  deltaX,
  deltaY,
}: {
  presentation: RuntimeImagePresentation;
  frameWidth: number;
  frameHeight: number;
  imageWidth: number;
  imageHeight: number;
  deltaX: number;
  deltaY: number;
}): RuntimeImagePresentation {
  const layout = getRuntimeImageLayout({
    presentation,
    frameWidth,
    frameHeight,
    imageWidth,
    imageHeight,
  });
  if (!layout) return presentation;

  const horizontalRange = frameWidth - layout.width;
  const verticalRange = frameHeight - layout.height;
  const nextLeft = Math.min(
    Math.max(layout.left + deltaX, Math.min(0, horizontalRange)),
    Math.max(0, horizontalRange),
  );
  const nextTop = Math.min(
    Math.max(layout.top + deltaY, Math.min(0, verticalRange)),
    Math.max(0, verticalRange),
  );

  return {
    ...presentation,
    focal_x:
      Math.abs(horizontalRange) < Number.EPSILON
        ? presentation.focal_x
        : boundedNumber(nextLeft / horizontalRange, 0.5, 0, 1),
    focal_y:
      Math.abs(verticalRange) < Number.EPSILON
        ? presentation.focal_y
        : boundedNumber(nextTop / verticalRange, 0.5, 0, 1),
  };
}

/** Return CSS that renders the same normalized crop at any frame aspect ratio. */
export function runtimeImageStyle(presentation: RuntimeImagePresentation) {
  const focalPoint = `${presentation.focal_x * 100}% ${presentation.focal_y * 100}%`;
  return {
    objectFit: presentation.fit,
    objectPosition: focalPoint,
    transform: `scale(${presentation.zoom})`,
    transformOrigin: focalPoint,
  } as const;
}

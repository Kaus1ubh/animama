import type { SceneFocusLinesAnimation, SceneNormalizedRect } from "./types";

export type SceneViewportSize = {
  width: number;
  height: number;
};

export type ScenePointPx = {
  x: number;
  y: number;
};

export type SceneRectPx = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SceneFocusResolvedTarget = {
  source: "avatar_face" | "manual_box";
  rectPx: SceneRectPx;
  centerPx: ScenePointPx;
  pointsPx: ScenePointPx[];
};

export type SceneFocusLinePolygon = {
  id: string;
  points: string;
  animationDurationMs: number;
  animationDelayMs: number;
  maxOpacity: number;
};

type FocusLinePolygonBuildArgs = {
  animation: SceneFocusLinesAnimation;
  baseThicknessPx: number;
  lengthVariation: number;
  lineCount: number;
  opacity: number;
  overscanPx: number;
  seed: number;
  target: SceneFocusResolvedTarget;
  thicknessVariationPx: number;
  viewport: SceneViewportSize;
};

const MIN_NORMALIZED_RECT_SIZE = 0.02;
const MIN_PIXEL_RECT_SIZE = 1;
const DEFAULT_TARGET_DELTA_THRESHOLD_PX = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

function rectCenter(rect: SceneRectPx): ScenePointPx {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function clampRectToViewport(
  rect: SceneRectPx,
  viewport: SceneViewportSize,
): SceneRectPx {
  const width = clamp(rect.width, MIN_PIXEL_RECT_SIZE, viewport.width);
  const height = clamp(rect.height, MIN_PIXEL_RECT_SIZE, viewport.height);

  return {
    x: clamp(rect.x, 0, Math.max(0, viewport.width - width)),
    y: clamp(rect.y, 0, Math.max(0, viewport.height - height)),
    width,
    height,
  };
}

/** Deterministic random numbers in [0, 1) from a seed (mulberry32). */
export function createMulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function distance(left: ScenePointPx, right: ScenePointPx): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function expandRect(
  rect: SceneRectPx,
  paddingXPx: number,
  paddingYPx: number,
): SceneRectPx {
  return {
    x: rect.x - paddingXPx,
    y: rect.y - paddingYPx,
    width: rect.width + paddingXPx * 2,
    height: rect.height + paddingYPx * 2,
  };
}

function resolveNormalizedRect(rect: SceneNormalizedRect): SceneNormalizedRect {
  const width = clamp(
    Number.isFinite(rect.width) ? rect.width : MIN_NORMALIZED_RECT_SIZE,
    MIN_NORMALIZED_RECT_SIZE,
    1,
  );
  const height = clamp(
    Number.isFinite(rect.height) ? rect.height : MIN_NORMALIZED_RECT_SIZE,
    MIN_NORMALIZED_RECT_SIZE,
    1,
  );
  const x = clamp(
    Number.isFinite(rect.x) ? rect.x : 0,
    0,
    Math.max(0, 1 - width),
  );
  const y = clamp(
    Number.isFinite(rect.y) ? rect.y : 0,
    0,
    Math.max(0, 1 - height),
  );

  return {
    x,
    y,
    width,
    height,
  };
}

function rayRectIntersectionDistance(args: {
  center: ScenePointPx;
  direction: ScenePointPx;
  overscanPx: number;
  viewport: SceneViewportSize;
}): number | null {
  const { center, direction, overscanPx, viewport } = args;
  const minX = -overscanPx;
  const minY = -overscanPx;
  const maxX = viewport.width + overscanPx;
  const maxY = viewport.height + overscanPx;
  const candidates: number[] = [];

  if (Math.abs(direction.x) > 1e-6) {
    const leftT = (minX - center.x) / direction.x;
    const rightT = (maxX - center.x) / direction.x;
    [leftT, rightT].forEach((candidate) => {
      if (candidate <= 0) return;
      const y = center.y + direction.y * candidate;
      if (y >= minY && y <= maxY) {
        candidates.push(candidate);
      }
    });
  }

  if (Math.abs(direction.y) > 1e-6) {
    const topT = (minY - center.y) / direction.y;
    const bottomT = (maxY - center.y) / direction.y;
    [topT, bottomT].forEach((candidate) => {
      if (candidate <= 0) return;
      const x = center.x + direction.x * candidate;
      if (x >= minX && x <= maxX) {
        candidates.push(candidate);
      }
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  return Math.min(...candidates);
}

function buildAvatarFaceRect(args: {
  leftEye: ScenePointPx | null;
  mouth: ScenePointPx | null;
  paddingXPx: number;
  paddingYPx: number;
  rightEye: ScenePointPx | null;
  viewport: SceneViewportSize;
}): SceneRectPx | null {
  const { leftEye, mouth, paddingXPx, paddingYPx, rightEye, viewport } = args;
  const points = [leftEye, rightEye, mouth].filter(
    (point): point is ScenePointPx => point !== null,
  );

  if (points.length === 0) {
    return null;
  }

  if (leftEye && rightEye && mouth) {
    const minX = Math.min(leftEye.x, rightEye.x, mouth.x);
    const maxX = Math.max(leftEye.x, rightEye.x, mouth.x);
    const minY = Math.min(leftEye.y, rightEye.y, mouth.y);
    const maxY = Math.max(leftEye.y, rightEye.y, mouth.y);
    return clampRectToViewport(
      expandRect(
        {
          x: minX,
          y: minY,
          width: Math.max(MIN_PIXEL_RECT_SIZE, maxX - minX),
          height: Math.max(MIN_PIXEL_RECT_SIZE, maxY - minY),
        },
        paddingXPx,
        paddingYPx,
      ),
      viewport,
    );
  }

  if (leftEye && rightEye) {
    const eyeDistance = Math.max(distance(leftEye, rightEye), 16);
    const centerX = (leftEye.x + rightEye.x) / 2;
    const centerY = (leftEye.y + rightEye.y) / 2;
    return clampRectToViewport(
      expandRect(
        {
          x: centerX - eyeDistance * 0.85,
          y: centerY - eyeDistance * 0.55,
          width: eyeDistance * 1.7,
          height: eyeDistance * 1.9,
        },
        paddingXPx,
        paddingYPx,
      ),
      viewport,
    );
  }

  const point = points[0];
  const baseWidth = Math.max(32, paddingXPx * 2.5);
  const baseHeight = Math.max(32, paddingYPx * 2.5);
  return clampRectToViewport(
    {
      x: point.x - baseWidth / 2,
      y: point.y - baseHeight / 2,
      width: baseWidth,
      height: baseHeight,
    },
    viewport,
  );
}

export function hashStringToSeed(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function resolveManualFocusTarget(args: {
  rect: SceneNormalizedRect;
  viewport: SceneViewportSize;
}): SceneFocusResolvedTarget | null {
  const { viewport } = args;
  if (viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }

  const normalizedRect = resolveNormalizedRect(args.rect);
  const rectPx = clampRectToViewport(
    {
      x: normalizedRect.x * viewport.width,
      y: normalizedRect.y * viewport.height,
      width: normalizedRect.width * viewport.width,
      height: normalizedRect.height * viewport.height,
    },
    viewport,
  );

  return {
    source: "manual_box",
    rectPx,
    centerPx: rectCenter(rectPx),
    pointsPx: [rectCenter(rectPx)],
  };
}

export function resolveAvatarFaceFocusTarget(args: {
  leftEye: ScenePointPx | null;
  mouth: ScenePointPx | null;
  paddingXPx: number;
  paddingYPx: number;
  rightEye: ScenePointPx | null;
  viewport: SceneViewportSize;
}): SceneFocusResolvedTarget | null {
  const rectPx = buildAvatarFaceRect(args);
  if (!rectPx) {
    return null;
  }

  return {
    source: "avatar_face",
    rectPx,
    centerPx: rectCenter(rectPx),
    pointsPx: [args.leftEye, args.rightEye, args.mouth].filter(
      (point): point is ScenePointPx => point !== null,
    ),
  };
}

export function areResolvedTargetsSimilar(
  left: SceneFocusResolvedTarget | null,
  right: SceneFocusResolvedTarget | null,
  thresholdPx: number = DEFAULT_TARGET_DELTA_THRESHOLD_PX,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.source === right.source &&
    Math.abs(left.centerPx.x - right.centerPx.x) <= thresholdPx &&
    Math.abs(left.centerPx.y - right.centerPx.y) <= thresholdPx &&
    Math.abs(left.rectPx.width - right.rectPx.width) <= thresholdPx &&
    Math.abs(left.rectPx.height - right.rectPx.height) <= thresholdPx
  );
}

export function buildFocusLinePolygons(
  args: FocusLinePolygonBuildArgs,
): SceneFocusLinePolygon[] {
  if (args.viewport.width <= 0 || args.viewport.height <= 0) {
    return [];
  }

  const lineCount = clamp(Math.round(args.lineCount), 1, 2000);
  const baseThicknessPx = Math.max(1, args.baseThicknessPx);
  const thicknessVariationPx = Math.max(0, args.thicknessVariationPx);
  const overscanPx = Math.max(0, args.overscanPx);
  const opacity = clamp01(args.opacity);
  const opacityJitter = clamp01(args.animation.opacityJitter);
  const minCycleMs = Math.max(
    40,
    args.animation.minVisibleMs + args.animation.minHiddenMs,
  );
  const maxCycleMs = Math.max(
    minCycleMs,
    args.animation.maxVisibleMs + args.animation.maxHiddenMs,
  );
  const center = args.target.centerPx;
  const rx = Math.max(args.target.rectPx.width / 2, MIN_PIXEL_RECT_SIZE);
  const ry = Math.max(args.target.rectPx.height / 2, MIN_PIXEL_RECT_SIZE);
  const random = createMulberry32(args.seed);
  const polygons: SceneFocusLinePolygon[] = [];
  const angleStep = (Math.PI * 2) / lineCount;

  for (let index = 0; index < lineCount; index += 1) {
    const angleJitter = (random() - 0.5) * angleStep * 0.9;
    const angle = angleStep * index + angleJitter;
    const direction = {
      x: Math.cos(angle),
      y: Math.sin(angle),
    };
    const ellipseT =
      1 /
      Math.sqrt(
        (direction.x * direction.x) / (rx * rx) +
          (direction.y * direction.y) / (ry * ry),
      );
    const outerT = rayRectIntersectionDistance({
      center,
      direction,
      overscanPx,
      viewport: args.viewport,
    });

    if (outerT === null || !Number.isFinite(outerT)) {
      continue;
    }

    const availableLength = outerT - ellipseT;
    if (availableLength <= 2) {
      continue;
    }

    const innerShift = availableLength * args.lengthVariation * random() * 0.6;
    const innerT = Math.min(
      outerT - Math.max(2, baseThicknessPx * 0.3),
      ellipseT + innerShift,
    );
    const thickness =
      baseThicknessPx + (random() * 2 - 1) * thicknessVariationPx;

    if (thickness <= 0 || innerT >= outerT) {
      continue;
    }

    const outerCenter = {
      x: center.x + direction.x * outerT,
      y: center.y + direction.y * outerT,
    };
    const innerTip = {
      x: center.x + direction.x * innerT,
      y: center.y + direction.y * innerT,
    };
    const perpendicular = {
      x: -direction.y,
      y: direction.x,
    };
    const halfThickness = thickness / 2;
    const outerLeft = {
      x: outerCenter.x + perpendicular.x * halfThickness,
      y: outerCenter.y + perpendicular.y * halfThickness,
    };
    const outerRight = {
      x: outerCenter.x - perpendicular.x * halfThickness,
      y: outerCenter.y - perpendicular.y * halfThickness,
    };
    const animationDurationMs = Math.round(
      minCycleMs + random() * Math.max(0, maxCycleMs - minCycleMs),
    );

    polygons.push({
      id: `focus-line:${index}`,
      points: [
        `${roundCoord(outerLeft.x)},${roundCoord(outerLeft.y)}`,
        `${roundCoord(outerRight.x)},${roundCoord(outerRight.y)}`,
        `${roundCoord(innerTip.x)},${roundCoord(innerTip.y)}`,
      ].join(" "),
      animationDurationMs,
      animationDelayMs: -Math.round(random() * animationDurationMs),
      maxOpacity: clamp01(opacity * (1 - random() * opacityJitter)),
    });
  }

  return polygons;
}

#!/usr/bin/env node
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DetectionKey = "face" | "leftEye" | "rightEye" | "mouth";

type DetectionResult = {
  fileName: string;
  assetPath: string;
  width: number;
  height: number;
  pixelRects: Record<DetectionKey, Rect>;
  normalizedRects: Record<DetectionKey, Rect>;
};

type ImageDataSet = {
  width: number;
  height: number;
  channels: number;
  original: Uint8Array<ArrayBufferLike>;
  mediumBlurred: Uint8Array<ArrayBufferLike>;
  wideBlurred: Uint8Array<ArrayBufferLike>;
};

type Component = {
  area: number;
  sumScore: number;
  bbox: Rect;
  centroidX: number;
  centroidY: number;
};

type SearchSpec = {
  window: Rect;
  expectedCenterX: number;
  expectedCenterY: number;
  percentile: number;
  minArea: number;
  minWidth?: number;
  minHeight?: number;
  minAspect?: number;
  maxAspect?: number;
  targetAspect: number;
  aspectTolerance: number;
  paddingX: number;
  paddingY: number;
  tightenRowsRatio?: number;
  tightenColsRatio?: number;
  lowerPenaltyStart?: number;
  lowerPenaltyStrength?: number;
};

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const FRONTEND_ROOT = path.resolve(SCRIPT_DIR, "..");
const EFFECTS_DIR = path.join(FRONTEND_ROOT, "web", "public", "effects");
const OUTPUT_JSON = path.join(EFFECTS_DIR, "face-material-bounds.json");
const OUTPUT_DEBUG_DIR = path.join(EFFECTS_DIR, "debug");

const EYE_SEARCH: Record<"leftEye" | "rightEye", SearchSpec> = {
  leftEye: {
    window: { x: 0.15, y: 0.4, width: 0.3, height: 0.2 },
    expectedCenterX: 0.34,
    expectedCenterY: 0.5,
    percentile: 0.84,
    minArea: 220,
    minWidth: 60,
    minHeight: 40,
    minAspect: 0.55,
    maxAspect: 3.4,
    targetAspect: 1.35,
    aspectTolerance: 1.3,
    paddingX: 0.1,
    paddingY: 0.08,
    tightenRowsRatio: 0.18,
    tightenColsRatio: 0.12,
    lowerPenaltyStart: 0.72,
    lowerPenaltyStrength: 0.86,
  },
  rightEye: {
    window: { x: 0.55, y: 0.4, width: 0.3, height: 0.2 },
    expectedCenterX: 0.66,
    expectedCenterY: 0.5,
    percentile: 0.84,
    minArea: 220,
    minWidth: 60,
    minHeight: 40,
    minAspect: 0.55,
    maxAspect: 3.4,
    targetAspect: 1.35,
    aspectTolerance: 1.3,
    paddingX: 0.1,
    paddingY: 0.08,
    tightenRowsRatio: 0.18,
    tightenColsRatio: 0.12,
    lowerPenaltyStart: 0.72,
    lowerPenaltyStrength: 0.86,
  },
};

const MOUTH_SEARCH: SearchSpec = {
  window: { x: 0.36, y: 0.62, width: 0.28, height: 0.18 },
  expectedCenterX: 0.5,
  expectedCenterY: 0.75,
  percentile: 0.93,
  minArea: 60,
  targetAspect: 3.6,
  aspectTolerance: 3.2,
  paddingX: 0.28,
  paddingY: 0.45,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rectFromNormalized(width: number, height: number, rect: Rect): Rect {
  return {
    x: Math.round(rect.x * width),
    y: Math.round(rect.y * height),
    width: Math.round(rect.width * width),
    height: Math.round(rect.height * height),
  };
}

function normalizeRect(width: number, height: number, rect: Rect): Rect {
  return {
    x: Number((rect.x / width).toFixed(6)),
    y: Number((rect.y / height).toFixed(6)),
    width: Number((rect.width / width).toFixed(6)),
    height: Number((rect.height / height).toFixed(6)),
  };
}

function inflateRect(rect: Rect, paddingX: number, paddingY: number): Rect {
  return {
    x: rect.x - rect.width * paddingX,
    y: rect.y - rect.height * paddingY,
    width: rect.width * (1 + paddingX * 2),
    height: rect.height * (1 + paddingY * 2),
  };
}

function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = clamp(rect.x, 0, width);
  const y = clamp(rect.y, 0, height);
  const maxWidth = width - x;
  const maxHeight = height - y;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(clamp(rect.width, 1, maxWidth)),
    height: Math.round(clamp(rect.height, 1, maxHeight)),
  };
}

function indexFor(image: ImageDataSet, x: number, y: number) {
  return (y * image.width + x) * image.channels;
}

function rgbAt(
  buffer: Uint8Array<ArrayBufferLike>,
  image: ImageDataSet,
  x: number,
  y: number,
) {
  const index = indexFor(image, x, y);
  return {
    r: buffer[index] ?? 0,
    g: buffer[index + 1] ?? 0,
    b: buffer[index + 2] ?? 0,
    a: buffer[index + 3] ?? 255,
  };
}

function luminance(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function colorDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function estimateBorderColor(image: ImageDataSet) {
  const border = Math.max(
    8,
    Math.round(Math.min(image.width, image.height) * 0.05),
  );
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (
        x >= border &&
        y >= border &&
        x < image.width - border &&
        y < image.height - border
      ) {
        continue;
      }
      const { r, g, b } = rgbAt(image.original, image, x, y);
      sumR += r;
      sumG += g;
      sumB += b;
      count += 1;
    }
  }

  return {
    r: sumR / count,
    g: sumG / count,
    b: sumB / count,
    luminance: luminance(sumR / count, sumG / count, sumB / count),
  };
}

function collectScores(
  scoreMap: Float32Array<ArrayBufferLike>,
  image: ImageDataSet,
  rect: Rect,
) {
  const xStart = clamp(Math.floor(rect.x), 0, image.width - 1);
  const yStart = clamp(Math.floor(rect.y), 0, image.height - 1);
  const xEnd = clamp(Math.ceil(rect.x + rect.width), xStart + 1, image.width);
  const yEnd = clamp(Math.ceil(rect.y + rect.height), yStart + 1, image.height);
  const scores: number[] = [];
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      scores.push(scoreMap[y * image.width + x] ?? 0);
    }
  }
  return scores.sort((a, b) => a - b);
}

function percentile(scores: number[], ratio: number) {
  if (scores.length === 0) return 0;
  const index = clamp(
    Math.floor((scores.length - 1) * ratio),
    0,
    scores.length - 1,
  );
  return scores[index] ?? 0;
}

function buildScoreMaps(image: ImageDataSet) {
  const size = image.width * image.height;
  const eyeScore = new Float32Array(size);
  const mouthScore = new Float32Array(size);
  const border = estimateBorderColor(image);

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = y * image.width + x;
      const original = rgbAt(image.original, image, x, y);
      const medium = rgbAt(image.mediumBlurred, image, x, y);
      const wide = rgbAt(image.wideBlurred, image, x, y);

      const fineDelta = colorDistance(original, medium);
      const diffuseDelta = colorDistance(medium, wide);
      const borderDelta = colorDistance(original, border);
      const originalL = luminance(original.r, original.g, original.b);
      const mediumL = luminance(medium.r, medium.g, medium.b);
      const wideL = luminance(wide.r, wide.g, wide.b);
      const originalWarmth =
        Math.max(0, original.r - original.g) +
        Math.max(0, original.r - original.b) * 0.35;
      const mediumWarmth =
        Math.max(0, medium.r - medium.g) +
        Math.max(0, medium.r - medium.b) * 0.35;
      const darkDetail = Math.max(0, mediumL - originalL);
      const localDarkness = Math.max(0, wideL - originalL);
      const borderDarkness = Math.max(0, border.luminance - originalL);
      const diffuseWarmth =
        Math.max(0, mediumWarmth - fineDelta * 0.6) +
        Math.max(0, diffuseDelta - fineDelta * 0.35);
      const edgeScore = fineDelta * 1.6 + darkDetail * 1.2 + borderDelta * 0.15;
      const pinkEdge = Math.min(originalWarmth, fineDelta * 1.15) * 0.55;

      eyeScore[index] = edgeScore + pinkEdge - diffuseWarmth * 1.35;
      mouthScore[index] =
        localDarkness * 2.1 + borderDarkness * 1.3 + fineDelta * 0.55;
    }
  }

  return { eyeScore, mouthScore };
}

function applySearchWeight(
  score: number,
  pixelWindow: Rect,
  spec: SearchSpec,
  x: number,
  y: number,
) {
  let weighted = score;
  if (
    spec.lowerPenaltyStart !== undefined &&
    spec.lowerPenaltyStrength !== undefined
  ) {
    const localY =
      pixelWindow.height <= 1 ? 0 : (y - pixelWindow.y) / pixelWindow.height;
    if (localY > spec.lowerPenaltyStart) {
      const progress =
        (localY - spec.lowerPenaltyStart) /
        Math.max(0.001, 1 - spec.lowerPenaltyStart);
      weighted *= Math.max(0.12, 1 - progress * spec.lowerPenaltyStrength);
    }
  }
  return weighted;
}

function estimateWindowBaseColor(image: ImageDataSet, rect: Rect) {
  const xStart = clamp(Math.floor(rect.x), 0, image.width - 1);
  const yStart = clamp(Math.floor(rect.y), 0, image.height - 1);
  const xEnd = clamp(Math.ceil(rect.x + rect.width), xStart + 1, image.width);
  const yEnd = clamp(Math.ceil(rect.y + rect.height), yStart + 1, image.height);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const localX = (x - xStart) / Math.max(1, xEnd - xStart);
      const localY = (y - yStart) / Math.max(1, yEnd - yStart);
      if (!(localY < 0.18 || localX < 0.12 || localX > 0.88)) {
        continue;
      }
      const { r, g, b } = rgbAt(image.original, image, x, y);
      sumR += r;
      sumG += g;
      sumB += b;
      count += 1;
    }
  }

  if (count === 0) {
    return estimateBorderColor(image);
  }

  return {
    r: sumR / count,
    g: sumG / count,
    b: sumB / count,
    luminance: luminance(sumR / count, sumG / count, sumB / count),
  };
}

function findComponents(
  mask: Uint8Array<ArrayBufferLike>,
  scoreMap: Float32Array<ArrayBufferLike>,
  image: ImageDataSet,
  rect: Rect,
) {
  const xStart = clamp(Math.floor(rect.x), 0, image.width - 1);
  const yStart = clamp(Math.floor(rect.y), 0, image.height - 1);
  const xEnd = clamp(Math.ceil(rect.x + rect.width), xStart + 1, image.width);
  const yEnd = clamp(Math.ceil(rect.y + rect.height), yStart + 1, image.height);
  const visited = new Uint8Array((xEnd - xStart) * (yEnd - yStart));
  const components: Component[] = [];

  function localIndex(x: number, y: number) {
    return (y - yStart) * (xEnd - xStart) + (x - xStart);
  }

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const globalIndex = y * image.width + x;
      const startIndex = localIndex(x, y);
      if (!mask[globalIndex] || visited[startIndex]) continue;

      const stack = [[x, y]];
      visited[startIndex] = 1;

      let area = 0;
      let sumScore = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;

      while (stack.length > 0) {
        const [currentX, currentY] = stack.pop() as [number, number];
        const currentIndex = currentY * image.width + currentX;
        area += 1;
        sumScore += scoreMap[currentIndex] ?? 0;
        sumX += currentX;
        sumY += currentY;
        minX = Math.min(minX, currentX);
        minY = Math.min(minY, currentY);
        maxX = Math.max(maxX, currentX);
        maxY = Math.max(maxY, currentY);

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue;
            const nextX = currentX + offsetX;
            const nextY = currentY + offsetY;
            if (
              nextX < xStart ||
              nextY < yStart ||
              nextX >= xEnd ||
              nextY >= yEnd
            ) {
              continue;
            }
            const nextGlobalIndex = nextY * image.width + nextX;
            const nextLocalIndex = localIndex(nextX, nextY);
            if (!mask[nextGlobalIndex] || visited[nextLocalIndex]) continue;
            visited[nextLocalIndex] = 1;
            stack.push([nextX, nextY]);
          }
        }
      }

      components.push({
        area,
        sumScore,
        bbox: {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
        centroidX: sumX / area,
        centroidY: sumY / area,
      });
    }
  }

  return components;
}

function selectComponent(
  components: Component[],
  image: ImageDataSet,
  spec: SearchSpec,
) {
  const expectedX = image.width * spec.expectedCenterX;
  const expectedY = image.height * spec.expectedCenterY;
  const windowDiagonal = Math.hypot(
    spec.window.width * image.width,
    spec.window.height * image.height,
  );

  let bestComponent: Component | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const component of components) {
    if (component.area < spec.minArea) continue;
    if (spec.minWidth !== undefined && component.bbox.width < spec.minWidth) {
      continue;
    }
    if (
      spec.minHeight !== undefined &&
      component.bbox.height < spec.minHeight
    ) {
      continue;
    }

    const aspect = component.bbox.width / Math.max(1, component.bbox.height);
    if (spec.minAspect !== undefined && aspect < spec.minAspect) continue;
    if (spec.maxAspect !== undefined && aspect > spec.maxAspect) continue;
    const aspectPenalty =
      Math.abs(aspect - spec.targetAspect) / spec.aspectTolerance;
    const centerDistance = Math.hypot(
      component.centroidX - expectedX,
      component.centroidY - expectedY,
    );
    const centerPenalty = centerDistance / Math.max(1, windowDiagonal);
    const compactnessBonus = Math.min(
      1.25,
      component.area /
        Math.max(1, component.bbox.width * component.bbox.height),
    );
    const score =
      component.sumScore * compactnessBonus -
      aspectPenalty * 800 -
      centerPenalty * 2200;

    if (score > bestScore) {
      bestScore = score;
      bestComponent = component;
    }
  }

  return bestComponent;
}

function tightenRectByProjection(
  scoreMap: Float32Array<ArrayBufferLike>,
  image: ImageDataSet,
  rect: Rect,
  rowRatio: number,
  colRatio: number,
) {
  const xStart = clamp(rect.x, 0, image.width - 1);
  const yStart = clamp(rect.y, 0, image.height - 1);
  const xEnd = clamp(rect.x + rect.width, xStart + 1, image.width);
  const yEnd = clamp(rect.y + rect.height, yStart + 1, image.height);
  const rows = new Array(yEnd - yStart).fill(0);
  const cols = new Array(xEnd - xStart).fill(0);

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const score = scoreMap[y * image.width + x] ?? 0;
      rows[y - yStart] += score;
      cols[x - xStart] += score;
    }
  }

  const maxRow = Math.max(...rows, 0);
  const maxCol = Math.max(...cols, 0);
  const rowThreshold = maxRow * rowRatio;
  const colThreshold = maxCol * colRatio;

  let top = rows.findIndex((score) => score >= rowThreshold);
  let bottom =
    rows.length -
    1 -
    [...rows].reverse().findIndex((score) => score >= rowThreshold);
  let left = cols.findIndex((score) => score >= colThreshold);
  let right =
    cols.length -
    1 -
    [...cols].reverse().findIndex((score) => score >= colThreshold);

  if (top < 0 || bottom < 0 || left < 0 || right < 0) {
    return rect;
  }

  if (bottom < top || right < left) {
    return rect;
  }

  return {
    x: xStart + left,
    y: yStart + top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function detectRegion(
  scoreMap: Float32Array<ArrayBufferLike>,
  image: ImageDataSet,
  spec: SearchSpec,
  fallback: Rect,
) {
  const pixelWindow = rectFromNormalized(
    image.width,
    image.height,
    spec.window,
  );
  const weightedScoreMap = new Float32Array(image.width * image.height);
  const scores: number[] = [];
  const xStart = pixelWindow.x;
  const yStart = pixelWindow.y;
  const xEnd = clamp(
    pixelWindow.x + pixelWindow.width,
    xStart + 1,
    image.width,
  );
  const yEnd = clamp(
    pixelWindow.y + pixelWindow.height,
    yStart + 1,
    image.height,
  );

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const index = y * image.width + x;
      const weighted = applySearchWeight(
        scoreMap[index] ?? 0,
        pixelWindow,
        spec,
        x,
        y,
      );
      weightedScoreMap[index] = weighted;
      scores.push(weighted);
    }
  }

  scores.sort((a, b) => a - b);
  const threshold = percentile(scores, spec.percentile);
  const mask = new Uint8Array(image.width * image.height);

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const index = y * image.width + x;
      if ((weightedScoreMap[index] ?? 0) >= threshold) {
        mask[index] = 1;
      }
    }
  }

  const components = findComponents(mask, weightedScoreMap, image, pixelWindow);
  const best = selectComponent(components, image, spec);
  if (!best) {
    return clampRect(
      inflateRect(fallback, spec.paddingX, spec.paddingY),
      image.width,
      image.height,
    );
  }

  let tightenedRect = best.bbox;
  if (
    spec.tightenRowsRatio !== undefined &&
    spec.tightenColsRatio !== undefined
  ) {
    tightenedRect = tightenRectByProjection(
      weightedScoreMap,
      image,
      best.bbox,
      spec.tightenRowsRatio,
      spec.tightenColsRatio,
    );
  }

  return clampRect(
    inflateRect(tightenedRect, spec.paddingX, spec.paddingY),
    image.width,
    image.height,
  );
}

function detectEyeRegion(
  image: ImageDataSet,
  spec: SearchSpec,
  fallback: Rect,
) {
  const pixelWindow = rectFromNormalized(
    image.width,
    image.height,
    spec.window,
  );
  const windowBaseColor = estimateWindowBaseColor(image, pixelWindow);
  const windowBaseLuminance = luminance(
    windowBaseColor.r,
    windowBaseColor.g,
    windowBaseColor.b,
  );
  const scoreMap = new Float32Array(image.width * image.height);
  const mask = new Uint8Array(image.width * image.height);
  const scores: number[] = [];
  const xStart = pixelWindow.x;
  const yStart = pixelWindow.y;
  const xEnd = clamp(
    pixelWindow.x + pixelWindow.width,
    xStart + 1,
    image.width,
  );
  const yEnd = clamp(
    pixelWindow.y + pixelWindow.height,
    yStart + 1,
    image.height,
  );

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const index = y * image.width + x;
      const original = rgbAt(image.original, image, x, y);
      const wide = rgbAt(image.wideBlurred, image, x, y);
      const originalL = luminance(original.r, original.g, original.b);
      const localDistance = colorDistance(original, windowBaseColor);
      const localDetail = colorDistance(original, wide);
      const darkDelta = Math.max(0, windowBaseLuminance - originalL);
      const pinkLift =
        Math.max(0, original.r - original.g) * 0.22 +
        Math.max(0, original.r - original.b) * 0.08;
      const weighted = applySearchWeight(
        localDistance * 1.0 + localDetail * 0.85 + darkDelta * 0.35 + pinkLift,
        pixelWindow,
        spec,
        x,
        y,
      );
      scoreMap[index] = weighted;
      scores.push(weighted);
    }
  }

  scores.sort((a, b) => a - b);
  const threshold = percentile(scores, spec.percentile);

  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const index = y * image.width + x;
      if ((scoreMap[index] ?? 0) >= threshold) {
        mask[index] = 1;
      }
    }
  }

  const components = findComponents(mask, scoreMap, image, pixelWindow);
  const best = selectComponent(components, image, spec);
  if (!best) {
    return clampRect(
      inflateRect(fallback, spec.paddingX, spec.paddingY),
      image.width,
      image.height,
    );
  }

  const tightened =
    spec.tightenRowsRatio !== undefined && spec.tightenColsRatio !== undefined
      ? tightenRectByProjection(
          scoreMap,
          image,
          best.bbox,
          spec.tightenRowsRatio,
          spec.tightenColsRatio,
        )
      : best.bbox;

  return clampRect(
    inflateRect(tightened, spec.paddingX, spec.paddingY),
    image.width,
    image.height,
  );
}

function detectFaceFromFeatures(
  image: ImageDataSet,
  leftEye: Rect,
  rightEye: Rect,
  mouth: Rect,
) {
  const leftEyeCenterX = leftEye.x + leftEye.width / 2;
  const rightEyeCenterX = rightEye.x + rightEye.width / 2;
  const interocular = Math.max(1, rightEyeCenterX - leftEyeCenterX);
  const x = Math.min(leftEye.x, rightEye.x) - interocular * 0.42;
  const y = Math.min(leftEye.y, rightEye.y) - interocular * 0.95;
  const right =
    Math.max(leftEye.x + leftEye.width, rightEye.x + rightEye.width) +
    interocular * 0.42;
  const bottom = mouth.y + mouth.height + interocular * 0.95;

  return clampRect(
    {
      x,
      y,
      width: right - x,
      height: bottom - y,
    },
    image.width,
    image.height,
  );
}

function refineEyeRect(image: ImageDataSet, rect: Rect) {
  const widened = clampRect(
    {
      x: rect.x - rect.width * 0.06,
      y: rect.y - rect.height * 0.05,
      width: rect.width * 1.12,
      height: rect.height * 1.06,
    },
    image.width,
    image.height,
  );

  const aspect = widened.width / Math.max(1, widened.height);
  if (aspect >= 1.05) {
    return widened;
  }

  const targetHeight = Math.max(40, Math.round(widened.width / 1.18));
  return clampRect(
    {
      x: widened.x,
      y: widened.y,
      width: widened.width,
      height: Math.min(widened.height, targetHeight),
    },
    image.width,
    image.height,
  );
}

async function loadImage(filePath: string): Promise<ImageDataSet> {
  const source = sharp(filePath).ensureAlpha();
  const [{ data, info }, mediumBlurred, wideBlurred] = await Promise.all([
    source.raw().toBuffer({ resolveWithObject: true }),
    source.clone().blur(10).raw().toBuffer(),
    source.clone().blur(26).raw().toBuffer(),
  ]);

  return {
    width: info.width,
    height: info.height,
    channels: info.channels,
    original: data,
    mediumBlurred,
    wideBlurred,
  };
}

function defaultEyeFallback(width: number, height: number, centerX: number) {
  return {
    x: Math.round(width * centerX - width * 0.07),
    y: Math.round(height * 0.46),
    width: Math.round(width * 0.14),
    height: Math.round(height * 0.09),
  };
}

function defaultMouthFallback(width: number, height: number) {
  return {
    x: Math.round(width * 0.43),
    y: Math.round(height * 0.72),
    width: Math.round(width * 0.14),
    height: Math.round(height * 0.05),
  };
}

function buildOverlaySvg(result: DetectionResult) {
  const colors: Record<DetectionKey, string> = {
    face: "#22c55e",
    leftEye: "#3b82f6",
    rightEye: "#8b5cf6",
    mouth: "#ef4444",
  };

  const labelYOffset: Record<DetectionKey, number> = {
    face: -10,
    leftEye: -10,
    rightEye: -10,
    mouth: -10,
  };

  const shapes = (Object.keys(result.pixelRects) as DetectionKey[])
    .map((key) => {
      const rect = result.pixelRects[key];
      const color = colors[key];
      const labelY = Math.max(16, rect.y + labelYOffset[key]);
      return `
        <rect
          x="${rect.x}"
          y="${rect.y}"
          width="${rect.width}"
          height="${rect.height}"
          fill="none"
          stroke="${color}"
          stroke-width="4"
        />
        <rect
          x="${rect.x}"
          y="${Math.max(0, labelY - 16)}"
          width="${Math.max(86, key.length * 11)}"
          height="20"
          fill="${color}"
          opacity="0.85"
          rx="4"
        />
        <text
          x="${rect.x + 8}"
          y="${labelY - 2}"
          font-family="monospace"
          font-size="14"
          fill="#ffffff"
        >${key}</text>
      `;
    })
    .join("\n");

  return Buffer.from(
    `<svg width="${result.width}" height="${result.height}" xmlns="http://www.w3.org/2000/svg">
      ${shapes}
    </svg>`,
  );
}

async function detectForFile(fileName: string): Promise<DetectionResult> {
  const filePath = path.join(EFFECTS_DIR, fileName);
  const image = await loadImage(filePath);
  const { eyeScore, mouthScore } = buildScoreMaps(image);

  const leftEye = detectEyeRegion(
    image,
    EYE_SEARCH.leftEye,
    defaultEyeFallback(
      image.width,
      image.height,
      EYE_SEARCH.leftEye.expectedCenterX,
    ),
  );
  const rightEye = detectEyeRegion(
    image,
    EYE_SEARCH.rightEye,
    defaultEyeFallback(
      image.width,
      image.height,
      EYE_SEARCH.rightEye.expectedCenterX,
    ),
  );
  const refinedLeftEye = refineEyeRect(image, leftEye);
  const refinedRightEye = refineEyeRect(image, rightEye);
  const mouth = detectRegion(
    mouthScore,
    image,
    MOUTH_SEARCH,
    defaultMouthFallback(image.width, image.height),
  );
  const face = detectFaceFromFeatures(
    image,
    refinedLeftEye,
    refinedRightEye,
    mouth,
  );

  const result: DetectionResult = {
    fileName,
    assetPath: `/effects/${fileName}`,
    width: image.width,
    height: image.height,
    pixelRects: {
      face,
      leftEye: refinedLeftEye,
      rightEye: refinedRightEye,
      mouth,
    },
    normalizedRects: {
      face: normalizeRect(image.width, image.height, face),
      leftEye: normalizeRect(image.width, image.height, refinedLeftEye),
      rightEye: normalizeRect(image.width, image.height, refinedRightEye),
      mouth: normalizeRect(image.width, image.height, mouth),
    },
  };

  await mkdir(OUTPUT_DEBUG_DIR, { recursive: true });
  await sharp(filePath)
    .composite([{ input: buildOverlaySvg(result), top: 0, left: 0 }])
    .png()
    .toFile(
      path.join(OUTPUT_DEBUG_DIR, fileName.replace(/\.png$/u, ".boxes.png")),
    );

  return result;
}

async function main() {
  const entries = await readdir(EFFECTS_DIR, { withFileTypes: true });
  const fileNames = entries
    .filter(
      (entry) => entry.isFile() && /^face-material.*\.png$/u.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();

  if (fileNames.length === 0) {
    throw new Error("No face-material PNGs found in public/effects.");
  }

  const results = await Promise.all(
    fileNames.map((fileName) => detectForFile(fileName)),
  );
  const output = {
    generatedAt: new Date().toISOString(),
    files: Object.fromEntries(
      results.map((result) => [result.assetPath, result]),
    ),
  };

  await writeFile(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Wrote ${OUTPUT_JSON}`);
  for (const result of results) {
    console.log(
      `${result.fileName}: face=${JSON.stringify(result.pixelRects.face)} leftEye=${JSON.stringify(result.pixelRects.leftEye)} rightEye=${JSON.stringify(result.pixelRects.rightEye)} mouth=${JSON.stringify(result.pixelRects.mouth)}`,
    );
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exit(1);
});

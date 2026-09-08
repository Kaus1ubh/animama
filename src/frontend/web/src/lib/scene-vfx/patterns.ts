import type { SceneBackgroundPatternKind } from "./types";

type SceneBackgroundPatternDataUrlArgs = {
  pattern: SceneBackgroundPatternKind;
  color: string;
  size: number;
  spacing: number;
};

const patternCache = new Map<string, string | null>();

function clampToFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizePatternSize(value: number): number {
  return Math.max(4, Math.round(clampToFinite(value, 16)));
}

export function getSceneBackgroundPatternTileSize(args: {
  size: number;
  spacing: number;
}): number {
  const size = normalizePatternSize(args.size);
  const spacing = Math.max(0, Math.round(clampToFinite(args.spacing, 0)));
  return Math.max(size + spacing, size + 4);
}

function buildStarPoints(args: { cx: number; cy: number; radius: number }) {
  const { cx, cy, radius } = args;
  const innerRadius = radius * 0.5;
  const points: string[] = [];

  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + index * (Math.PI / 5);
    const currentRadius = index % 2 === 0 ? radius : innerRadius;
    const x = cx + Math.cos(angle) * currentRadius;
    const y = cy + Math.sin(angle) * currentRadius;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }

  return points.join(" ");
}

function buildHeartPath(args: { cx: number; cy: number; size: number }) {
  const { cx, cy, size } = args;
  const half = size / 2;
  const quarter = size / 4;
  const left = cx - half;
  const right = cx + half;
  const top = cy - quarter;
  const bottom = cy + half;

  return [
    `M ${cx.toFixed(2)} ${bottom.toFixed(2)}`,
    `C ${(cx + half * 0.95).toFixed(2)} ${(cy + quarter * 0.7).toFixed(2)} ${(right + quarter * 0.2).toFixed(2)} ${(cy - quarter * 0.2).toFixed(2)} ${(cx + quarter * 0.7).toFixed(2)} ${top.toFixed(2)}`,
    `C ${(cx + quarter * 0.45).toFixed(2)} ${(cy - half * 0.7).toFixed(2)} ${(cx + quarter * 0.05).toFixed(2)} ${(cy - half * 0.45).toFixed(2)} ${cx.toFixed(2)} ${(cy - quarter * 0.05).toFixed(2)}`,
    `C ${(cx - quarter * 0.05).toFixed(2)} ${(cy - half * 0.45).toFixed(2)} ${(cx - quarter * 0.45).toFixed(2)} ${(cy - half * 0.7).toFixed(2)} ${(cx - quarter * 0.7).toFixed(2)} ${top.toFixed(2)}`,
    `C ${(left - quarter * 0.2).toFixed(2)} ${(cy - quarter * 0.2).toFixed(2)} ${(cx - half * 0.95).toFixed(2)} ${(cy + quarter * 0.7).toFixed(2)} ${cx.toFixed(2)} ${bottom.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function buildPatternSvg(
  args: SceneBackgroundPatternDataUrlArgs,
): string | null {
  if (args.pattern === "none") {
    return null;
  }

  const tileSize = getSceneBackgroundPatternTileSize(args);
  const shapeSize = Math.min(normalizePatternSize(args.size), tileSize - 2);
  const center = tileSize / 2;

  let shapeMarkup = "";
  switch (args.pattern) {
    case "polkadot":
      shapeMarkup = `<circle cx="${center}" cy="${center}" r="${shapeSize / 2}" fill="${args.color}" />`;
      break;
    case "heart":
      shapeMarkup = `<path d="${buildHeartPath({ cx: center, cy: center, size: shapeSize })}" fill="${args.color}" />`;
      break;
    case "star":
      shapeMarkup = `<polygon points="${buildStarPoints({ cx: center, cy: center, radius: shapeSize / 2 })}" fill="${args.color}" />`;
      break;
    default:
      return null;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tileSize} ${tileSize}" width="${tileSize}" height="${tileSize}">${shapeMarkup}</svg>`;
}

export function getSceneBackgroundPatternDataUrl(
  args: SceneBackgroundPatternDataUrlArgs,
): string | null {
  const key = JSON.stringify({
    pattern: args.pattern,
    color: args.color,
    size: normalizePatternSize(args.size),
    spacing: Math.max(0, Math.round(clampToFinite(args.spacing, 0))),
  });
  const cached = patternCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const svg = buildPatternSvg(args);
  const nextValue = svg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    : null;
  patternCache.set(key, nextValue);
  return nextValue;
}

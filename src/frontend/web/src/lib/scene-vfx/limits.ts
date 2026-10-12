/**
 * Ranges and counts for Scene Effect definitions (`animama/scene-effect/1`).
 *
 * Definitions are untrusted input from the creator, Local content and Portable
 * packages, so the creator checks them before Save and the backend checks the
 * same values at Save, scan and package import
 * (`app/contracts/scene_effect_limits.py`).
 * `lib/content/fixtures/scene-effect-limits.json` records the values for the
 * parity tests that keep the two equal. A range is `[minimum, maximum]`,
 * inclusive.
 */

import { isSceneLegacyEmojiItem } from "./types";

type Range = readonly [number, number];

export const SCENE_EFFECT_LIMITS = {
  durationMs: [100, 30_000],
  seed: [0, 4_294_967_295],
  pattern: { size: [1, 512], spacing: [0, 1024], opacity: [0, 1] },
  marquee: {
    items: 64,
    itemSize: [1, 1024],
    gap: [0, 2048],
    rowGap: [0, 2048],
    rotationDeg: [-360, 360],
    speedPxPerSec: [0, 2000],
    opacity: [0, 1],
  },
  focus: {
    lineCount: [1, 256],
    opacity: [0, 1],
    baseThicknessPx: [0.1, 128],
    thicknessVariationPx: [0, 128],
    lengthVariation: [0, 1],
    overscanPx: [0, 4096],
    paddingPx: [0, 2048],
    animationMs: [0, 10_000],
    opacityJitter: [0, 1],
  },
  /** C1: a linear or radial gradient fill of 2–4 stops. */
  gradient: {
    angleDeg: [0, 360],
    center: [0, 1],
    stops: [2, 4],
    position: [0, 1],
  },
  /** C2: one image tiled over the view, drifting. */
  tile: { size: [16, 1024], opacity: [0, 1], speedPxPerSec: [0, 600] },
  /** C3: procedural rays; `turnSeconds` 0 (still) or this range, signed. */
  rays: {
    count: [4, 48],
    center: [0, 1],
    turnSeconds: [4, 600],
    throbPerSec: [0, 4],
    opacity: [0, 1],
  },
  /** C3: procedural lines; `swaySeconds` 0 (still) or this range. */
  lines: {
    count: [4, 96],
    length: [0.05, 1],
    widthPx: [0.5, 16],
    swaySeconds: [1, 60],
    opacity: [0, 1],
  },
  /** C4 and C5: scattered items with per-item variation and motion. */
  scatter: {
    layers: 3,
    items: [1, 8],
    count: [1, 48],
    totalCount: 96,
    sizePx: [4, 512],
    rotationDeg: [-360, 360],
    opacity: [0, 1],
    region: [0, 1],
    speedPxPerSec: [0, 600],
    spinDegPerSec: [0, 720],
  },
  /** C6: one fade from a colour when the Scene starts. */
  flash: { durationMs: [50, 2000] },
} as const satisfies Record<string, Range | Record<string, Range | number>>;

/** Whether `value` is a finite number inside `range` (and whole, if asked). */
export function withinSceneRange(
  value: unknown,
  [minimum, maximum]: Range,
  integer = false,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum &&
    (!integer || Number.isInteger(value))
  );
}

/** A definition value outside its limits: the field path and why. */
export type SceneLimitIssue = { field: string; message: string };

type Definition = Record<string, unknown>;

function record(value: unknown): Definition | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Definition)
    : null;
}

/**
 * Check a stored Scene Effect definition's numbers and counts against
 * `SCENE_EFFECT_LIMITS`; structure, enums and colours are the parser's job.
 * The backend applies the same ranges (`_scene_effect` in
 * `content_package_capabilities.py`) at Save, Local scan and package import,
 * so a definition the creator refuses would be refused at Save too.
 */
export function sceneDefinitionLimitIssues(
  definition: Definition,
): SceneLimitIssue[] {
  const issues: SceneLimitIssue[] = [];
  const L = SCENE_EFFECT_LIMITS;
  const check = (
    owner: Definition | null,
    key: string,
    range: Range,
    field: string,
    integer = false,
  ) => {
    if (!owner || withinSceneRange(owner[key], range, integer)) return;
    issues.push({
      field,
      message: `${field} must be between ${range[0]} and ${range[1]}${integer ? " in whole steps" : ""}.`,
    });
  };
  const ordered = (
    owner: Definition,
    low: string,
    high: string,
    field: string,
  ) => {
    if (Number(owner[low]) > Number(owner[high]))
      issues.push({
        field,
        message: `${field}: the minimum cannot exceed the maximum.`,
      });
  };
  // Animama no longer provides Twemoji: Save refuses each emoji item, which
  // a Scene saved before the sticker set plays without.
  const legacyItems = (items: unknown, field: string) => {
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => {
      if (!isSceneLegacyEmojiItem(item)) return;
      const label = record(item)?.label;
      issues.push({
        field: `${field}.${index}`,
        message: `${typeof label === "string" && label.trim() ? label : "This item"} is an emoji, which Animama no longer provides. Replace it with a sticker or image, or remove it.`,
      });
    });
  };
  const count = (items: unknown, [minimum, maximum]: Range, field: string) => {
    const length = Array.isArray(items) ? items.length : 0;
    if (length < minimum || length > maximum)
      issues.push({
        field,
        message: `${field} needs ${minimum === maximum ? minimum : `${minimum} to ${maximum}`} entries.`,
      });
  };
  if (definition.durationMs !== null && definition.durationMs !== undefined)
    check(definition, "durationMs", L.durationMs, "durationMs", true);

  if (definition.kind === "focus_lines") {
    const F = L.focus;
    check(definition, "lineCount", F.lineCount, "focus.lineCount", true);
    check(definition, "opacity", F.opacity, "focus.opacity");
    check(
      definition,
      "baseThicknessPx",
      F.baseThicknessPx,
      "focus.baseThickness",
    );
    check(
      definition,
      "thicknessVariationPx",
      F.thicknessVariationPx,
      "focus.thicknessVariation",
    );
    check(
      definition,
      "lengthVariation",
      F.lengthVariation,
      "focus.lengthVariation",
    );
    check(definition, "overscanPx", F.overscanPx, "focus.overscan");
    if (definition.seed !== null && definition.seed !== undefined)
      check(definition, "seed", L.seed, "focus.seed", true);
    const target = record(definition.target);
    if (target?.kind === "avatar_face") {
      check(target, "paddingXPx", F.paddingPx, "focus.paddingX");
      check(target, "paddingYPx", F.paddingPx, "focus.paddingY");
    }
    const animation = record(definition.animation);
    for (const key of [
      "minVisibleMs",
      "maxVisibleMs",
      "minHiddenMs",
      "maxHiddenMs",
    ])
      check(animation, key, F.animationMs, `focus.animation.${key}`);
    check(
      animation,
      "opacityJitter",
      F.opacityJitter,
      "focus.animation.opacityJitter",
    );
    return issues;
  }

  const pattern = record(definition.pattern);
  check(pattern, "size", L.pattern.size, "pattern.size");
  check(pattern, "spacing", L.pattern.spacing, "pattern.spacing");
  check(pattern, "opacity", L.pattern.opacity, "pattern.opacity");
  const marquee = record(definition.marquee);
  if (marquee) {
    const M = L.marquee;
    count(marquee.items, [0, M.items], "marquee.items");
    legacyItems(marquee.items, "marquee.items");
    check(marquee, "itemSize", M.itemSize, "marquee.itemSize");
    check(marquee, "gap", M.gap, "marquee.gap");
    check(marquee, "rowGap", M.rowGap, "marquee.rowGap");
    check(marquee, "itemRotationOffsetDeg", M.rotationDeg, "marquee.rotation");
    check(marquee, "speedPxPerSec", M.speedPxPerSec, "marquee.speed");
    check(marquee, "opacity", M.opacity, "marquee.opacity");
  }

  const gradient = record(definition.gradient);
  if (gradient) {
    const G = L.gradient;
    check(gradient, "angleDeg", G.angleDeg, "gradient.angle");
    check(gradient, "centerX", G.center, "gradient.centerX");
    check(gradient, "centerY", G.center, "gradient.centerY");
    count(gradient.stops, G.stops, "gradient.stops");
    const stops = Array.isArray(gradient.stops) ? gradient.stops : [];
    stops.forEach((stop, index) =>
      check(record(stop), "position", G.position, `gradient.stops.${index}`),
    );
    const positions = stops.map((stop) => Number(record(stop)?.position));
    if (
      positions.some(
        (position, index) => index > 0 && position < positions[index - 1],
      )
    )
      issues.push({
        field: "gradient.stops",
        message: "gradient.stops must run in ascending position.",
      });
  }

  const tile = record(definition.tile);
  if (tile) {
    check(tile, "size", L.tile.size, "tile.size");
    check(tile, "opacity", L.tile.opacity, "tile.opacity");
    check(tile, "speedPxPerSec", L.tile.speedPxPerSec, "tile.speed");
  }

  const screen = record(definition.screen);
  if (screen?.kind === "rays") {
    const R = L.rays;
    check(screen, "count", R.count, "screen.count", true);
    check(screen, "opacity", R.opacity, "screen.opacity");
    check(screen, "centerX", R.center, "screen.centerX");
    check(screen, "centerY", R.center, "screen.centerY");
    check(screen, "throbPerSec", R.throbPerSec, "screen.throb");
    check(screen, "seed", L.seed, "screen.seed", true);
    if (screen.turnSeconds !== 0)
      check(
        { turnSeconds: Math.abs(Number(screen.turnSeconds)) },
        "turnSeconds",
        R.turnSeconds,
        "screen.turnSeconds",
      );
  } else if (screen?.kind === "lines") {
    const N = L.lines;
    check(screen, "count", N.count, "screen.count", true);
    check(screen, "opacity", N.opacity, "screen.opacity");
    check(screen, "minLength", N.length, "screen.minLength");
    check(screen, "maxLength", N.length, "screen.maxLength");
    ordered(screen, "minLength", "maxLength", "screen.length");
    check(screen, "minWidthPx", N.widthPx, "screen.minWidth");
    check(screen, "maxWidthPx", N.widthPx, "screen.maxWidth");
    ordered(screen, "minWidthPx", "maxWidthPx", "screen.width");
    check(screen, "seed", L.seed, "screen.seed", true);
    if (screen.swaySeconds !== 0)
      check(screen, "swaySeconds", N.swaySeconds, "screen.sway");
  }

  if (definition.scatters !== undefined) {
    const S = L.scatter;
    const layers = Array.isArray(definition.scatters)
      ? definition.scatters
      : [];
    count(layers, [0, S.layers], "scatters");
    let total = 0;
    layers.forEach((raw, index) => {
      const layer = record(raw);
      if (!layer) return;
      const field = (name: string) => `scatters.${index}.${name}`;
      count(layer.items, S.items, field("items"));
      legacyItems(layer.items, field("items"));
      check(layer, "count", S.count, field("count"), true);
      total += Number(layer.count) || 0;
      check(layer, "seed", L.seed, field("seed"), true);
      for (const [low, high, range, name] of [
        ["minSize", "maxSize", S.sizePx, "size"],
        ["minRotationDeg", "maxRotationDeg", S.rotationDeg, "rotation"],
        ["minOpacity", "maxOpacity", S.opacity, "opacity"],
        ["regionTop", "regionBottom", S.region, "region"],
        ["minSpinDegPerSec", "maxSpinDegPerSec", S.spinDegPerSec, "spin"],
      ] as const) {
        check(layer, low, range, field(low));
        check(layer, high, range, field(high));
        ordered(layer, low, high, field(name));
      }
      check(layer, "speedPxPerSec", S.speedPxPerSec, field("speed"));
    });
    if (total > S.totalCount)
      issues.push({
        field: "scatters",
        message: `Scattered layers can show at most ${S.totalCount} items in all.`,
      });
  }

  const flash = record(definition.flash);
  if (flash)
    check(flash, "durationMs", L.flash.durationMs, "flash.duration", true);
  return issues;
}

import { cloneJsonObject, readJsonObject } from "./json";
import { clamp01, readFiniteNumber, roundEditorNumber } from "./numbers";
import type {
  JsonArray,
  JsonObject,
  ParticleVFXEditorColor,
  ParticleVFXEditorColorOverLifeDraft,
  ParticleVFXEditorColorStop,
  ParticleVFXEditorStartColorDraft,
} from "./types";

export const DEFAULT_START_COLOR: ParticleVFXEditorColor = {
  r: 1,
  g: 1,
  b: 1,
  a: 1,
};

const DEFAULT_COLOR_OVER_LIFE_STOPS: ParticleVFXEditorColorStop[] = [
  colorStop(0, 1, 1, 1, 1),
  colorStop(0.75, 1, 1, 1, 1),
  colorStop(1, 1, 1, 1, 0),
];

export function readStartColorDraft(
  value: unknown,
): ParticleVFXEditorStartColorDraft {
  const generator = readJsonObject(value);
  if (!generator) {
    return { mode: "fixed", color: { ...DEFAULT_START_COLOR } };
  }

  if (generator.type === "ConstantColor") {
    return {
      mode: "fixed",
      color: readQuarksColor(generator.color, DEFAULT_START_COLOR),
    };
  }

  if (generator.type === "ColorRange" || generator.type === "RandomColor") {
    const from = readQuarksColor(generator.a, DEFAULT_START_COLOR);
    const to = readQuarksColor(generator.b, from);
    return { mode: "range", from, to };
  }

  return {
    mode: "unsupported",
    raw: cloneJsonObject(generator),
    fallbackColor: readColorGenerator(value, DEFAULT_START_COLOR) ?? {
      ...DEFAULT_START_COLOR,
    },
    label: readGeneratorLabel(generator),
  };
}

export function startColorDraftToGenerator(
  draft: ParticleVFXEditorStartColorDraft,
): JsonObject {
  if (draft.mode === "fixed") return colorToGenerator(draft.color);
  if (draft.mode === "unsupported") return cloneJsonObject(draft.raw);
  return {
    type: "ColorRange",
    a: colorToJson(draft.from),
    b: colorToJson(draft.to),
  };
}

export function getStartColorDraftPreviewColor(
  draft: ParticleVFXEditorStartColorDraft,
): ParticleVFXEditorColor {
  if (draft.mode === "fixed") return { ...draft.color };
  if (draft.mode === "unsupported") return { ...draft.fallbackColor };
  return { ...draft.from };
}

export function cloneStartColorDraft(
  draft: ParticleVFXEditorStartColorDraft,
): ParticleVFXEditorStartColorDraft {
  if (draft.mode === "fixed") {
    return { mode: "fixed", color: { ...draft.color } };
  }
  if (draft.mode === "range") {
    return {
      mode: "range",
      from: { ...draft.from },
      to: { ...draft.to },
    };
  }
  if (draft.mode === "theme") {
    return {
      mode: "theme",
      presetId: draft.presetId,
      from: { ...draft.from },
      to: { ...draft.to },
    };
  }
  return {
    mode: "unsupported",
    raw: cloneJsonObject(draft.raw),
    fallbackColor: { ...draft.fallbackColor },
    label: draft.label,
  };
}

function readColorGenerator(
  value: unknown,
  fallback: ParticleVFXEditorColor | null,
): ParticleVFXEditorColor | null {
  const generator = readJsonObject(value);
  if (!generator) return fallback;
  if (generator.type === "ConstantColor") {
    return readQuarksColor(generator.color, fallback);
  }
  if (generator.type === "ColorRange" || generator.type === "RandomColor") {
    return readQuarksColor(generator.a, fallback);
  }
  if (generator.type === "Gradient") {
    return readGradientStops(generator)?.[0]?.color ?? fallback;
  }
  if (generator.type === "RandomColorBetweenGradient") {
    const gradient = readJsonObject(generator.gradient1);
    return gradient
      ? (readGradientStops(gradient)?.[0]?.color ?? fallback)
      : fallback;
  }
  return fallback;
}

export function colorToGenerator(color: ParticleVFXEditorColor): JsonObject {
  return {
    type: "ConstantColor",
    color: colorToJson(color),
  };
}

export function readColorOverLifeDraft(
  ps: JsonObject,
): ParticleVFXEditorColorOverLifeDraft {
  const behavior = findColorOverLifeBehavior(ps);
  if (!behavior) return { mode: "off" };

  const generator = readJsonObject(behavior.color);
  if (!generator) {
    return {
      mode: "unsupported",
      raw: cloneJsonObject(behavior),
      label: "Missing color generator",
    };
  }

  if (generator.type === "Gradient") {
    const stops = readGradientStops(generator);
    if (!stops) return readUnsupportedColorOverLifeDraft(generator);
    return isFadeGradient(stops)
      ? { mode: "fade", stops }
      : { mode: "gradient", stops };
  }

  if (generator.type === "RandomColorBetweenGradient") {
    const gradientA = readJsonObject(generator.gradient1);
    const gradientB = readJsonObject(generator.gradient2);
    const stopsA = gradientA ? readGradientStops(gradientA) : null;
    const stopsB = gradientB ? readGradientStops(gradientB) : null;
    if (!stopsA || !stopsB) return readUnsupportedColorOverLifeDraft(generator);
    return {
      mode: "random-gradient",
      gradientA: stopsA,
      gradientB: stopsB,
    };
  }

  if (generator.type === "ConstantColor") {
    const color = readQuarksColor(generator.color, DEFAULT_START_COLOR);
    return {
      mode: "gradient",
      stops: [
        { position: 0, color },
        { position: 1, color: { ...color } },
      ],
    };
  }

  if (generator.type === "ColorRange" || generator.type === "RandomColor") {
    const from = readQuarksColor(generator.a, DEFAULT_START_COLOR);
    const to = readQuarksColor(generator.b, from);
    return {
      mode: "random-gradient",
      gradientA: [
        { position: 0, color: from },
        { position: 1, color: { ...from } },
      ],
      gradientB: [
        { position: 0, color: to },
        { position: 1, color: { ...to } },
      ],
    };
  }

  return readUnsupportedColorOverLifeDraft(generator);
}

function readUnsupportedColorOverLifeDraft(
  generator: JsonObject,
): ParticleVFXEditorColorOverLifeDraft {
  return {
    mode: "unsupported",
    raw: cloneJsonObject(generator),
    label: readGeneratorLabel(generator),
  };
}

export function setColorOverLifeDraft(
  ps: JsonObject,
  draft: ParticleVFXEditorColorOverLifeDraft,
): void {
  const behaviors = Array.isArray(ps.behaviors)
    ? (ps.behaviors as JsonArray)
    : [];
  const index = behaviors.findIndex(
    (behavior) => readJsonObject(behavior)?.type === "ColorOverLife",
  );

  if (draft.mode === "off") {
    if (index >= 0) behaviors.splice(index, 1);
    ps.behaviors = behaviors;
    return;
  }

  const behavior = colorOverLifeDraftToBehavior(draft);
  if (index >= 0) {
    behaviors[index] = behavior;
  } else {
    behaviors.push(behavior);
  }
  ps.behaviors = behaviors;
}

function colorOverLifeDraftToBehavior(
  draft: ParticleVFXEditorColorOverLifeDraft,
): JsonObject {
  if (draft.mode === "off") {
    return {
      type: "ColorOverLife",
      color: gradientStopsToJson(DEFAULT_COLOR_OVER_LIFE_STOPS),
    };
  }
  if (draft.mode === "unsupported") {
    return {
      type: "ColorOverLife",
      color: cloneJsonObject(draft.raw),
    };
  }
  if (draft.mode === "random-gradient") {
    return {
      type: "ColorOverLife",
      color: {
        type: "RandomColorBetweenGradient",
        gradient1: gradientStopsToJson(draft.gradientA),
        gradient2: gradientStopsToJson(draft.gradientB),
      },
    };
  }
  return {
    type: "ColorOverLife",
    color: gradientStopsToJson(draft.stops),
  };
}

export function createDefaultColorOverLifeDraft(): ParticleVFXEditorColorOverLifeDraft {
  return {
    mode: "fade",
    stops: cloneColorStops(DEFAULT_COLOR_OVER_LIFE_STOPS),
  };
}

export function cloneColorOverLifeDraft(
  draft: ParticleVFXEditorColorOverLifeDraft,
): ParticleVFXEditorColorOverLifeDraft {
  if (draft.mode === "off") return { mode: "off" };
  if (draft.mode === "unsupported") {
    return {
      mode: "unsupported",
      raw: cloneJsonObject(draft.raw),
      label: draft.label,
    };
  }
  if (draft.mode === "random-gradient") {
    return {
      mode: "random-gradient",
      gradientA: cloneColorStops(draft.gradientA),
      gradientB: cloneColorStops(draft.gradientB),
    };
  }
  return {
    mode: draft.mode,
    stops: cloneColorStops(draft.stops),
  };
}

function readGradientStops(
  generator: JsonObject,
): ParticleVFXEditorColorStop[] | null {
  const colorKeys = readColorFunctionKeys(generator.color);
  const alphaKeys = readNumberFunctionKeys(generator.alpha);
  if (colorKeys.length === 0 && alphaKeys.length === 0) return null;

  const positions = new Set<number>();
  for (const key of colorKeys) positions.add(key.position);
  for (const key of alphaKeys) positions.add(key.position);
  if (positions.size === 0) positions.add(0);

  return sanitizeColorStops(
    [...positions].map((position) => {
      const color = sampleColorKeys(colorKeys, position);
      return {
        position,
        color: {
          r: color.r,
          g: color.g,
          b: color.b,
          a: sampleNumberKeys(alphaKeys, position) ?? 1,
        },
      };
    }),
  );
}

function gradientStopsToJson(stops: ParticleVFXEditorColorStop[]): JsonObject {
  const sanitized = sanitizeColorStops(stops);
  return {
    type: "Gradient",
    color: {
      type: "CLinearFunction",
      subType: "Color",
      keys: sanitized.map((stop) => ({
        value: {
          r: roundEditorNumber(stop.color.r),
          g: roundEditorNumber(stop.color.g),
          b: roundEditorNumber(stop.color.b),
        },
        pos: roundEditorNumber(stop.position),
      })),
    },
    alpha: {
      type: "CLinearFunction",
      subType: "Number",
      keys: sanitized.map((stop) => ({
        value: roundEditorNumber(stop.color.a),
        pos: roundEditorNumber(stop.position),
      })),
    },
  };
}

function readColorFunctionKeys(value: unknown): Array<{
  position: number;
  color: ParticleVFXEditorColor;
}> {
  const fn = readJsonObject(value);
  const keys = Array.isArray(fn?.keys) ? fn.keys : [];
  return keys
    .flatMap((key) => {
      const object = readJsonObject(key);
      const position = readFiniteNumber(object?.pos);
      const color = readQuarksColor(object?.value, null);
      return position === null || !color ? [] : [{ position, color }];
    })
    .sort((a, b) => a.position - b.position);
}

function readNumberFunctionKeys(value: unknown): Array<{
  position: number;
  value: number;
}> {
  const fn = readJsonObject(value);
  const keys = Array.isArray(fn?.keys) ? fn.keys : [];
  return keys
    .flatMap((key) => {
      const object = readJsonObject(key);
      const position = readFiniteNumber(object?.pos);
      const number = readFiniteNumber(object?.value);
      return position === null || number === null
        ? []
        : [{ position, value: number }];
    })
    .sort((a, b) => a.position - b.position);
}

function sampleColorKeys(
  keys: Array<{ position: number; color: ParticleVFXEditorColor }>,
  position: number,
): ParticleVFXEditorColor {
  if (keys.length === 0) return { ...DEFAULT_START_COLOR };
  const before = findNearestKeyBefore(keys, position);
  const after = findNearestKeyAfter(keys, position);
  if (!before) return { ...after!.color };
  if (!after) return { ...before.color };
  if (before === after || before.position === after.position) {
    return { ...before.color };
  }
  const ratio =
    (position - before.position) / (after.position - before.position);
  return {
    r: lerp(before.color.r, after.color.r, ratio),
    g: lerp(before.color.g, after.color.g, ratio),
    b: lerp(before.color.b, after.color.b, ratio),
    a: lerp(before.color.a, after.color.a, ratio),
  };
}

function sampleNumberKeys(
  keys: Array<{ position: number; value: number }>,
  position: number,
): number | null {
  if (keys.length === 0) return null;
  const before = findNearestKeyBefore(keys, position);
  const after = findNearestKeyAfter(keys, position);
  if (!before) return after!.value;
  if (!after) return before.value;
  if (before === after || before.position === after.position)
    return before.value;
  const ratio =
    (position - before.position) / (after.position - before.position);
  return lerp(before.value, after.value, ratio);
}

function findNearestKeyBefore<T extends { position: number }>(
  keys: T[],
  position: number,
): T | null {
  let nearest: T | null = null;
  for (const key of keys) {
    if (key.position <= position) nearest = key;
  }
  return nearest;
}

function findNearestKeyAfter<T extends { position: number }>(
  keys: T[],
  position: number,
): T | null {
  return keys.find((key) => key.position >= position) ?? null;
}

function sanitizeColorStops(
  stops: readonly ParticleVFXEditorColorStop[],
): ParticleVFXEditorColorStop[] {
  const next = new Map<number, ParticleVFXEditorColorStop>();
  for (const stop of stops) {
    const position = roundEditorNumber(clamp01(stop.position));
    next.set(position, {
      position,
      color: clampColor(stop.color),
    });
  }
  const sorted = [...next.values()].sort((a, b) => a.position - b.position);
  if (sorted.length === 0)
    return cloneColorStops(DEFAULT_COLOR_OVER_LIFE_STOPS);
  if (sorted.length === 1) {
    const first = sorted[0];
    return [
      { ...first, position: 0 },
      { position: 1, color: { ...first.color } },
    ];
  }
  return sorted;
}

function isFadeGradient(stops: readonly ParticleVFXEditorColorStop[]): boolean {
  const sanitized = sanitizeColorStops(stops);
  const last = sanitized.at(-1);
  return (
    !!last &&
    last.color.a <= 0.001 &&
    sanitized.some((stop) => stop.color.a > 0.5) &&
    sanitized.every(
      (stop) =>
        Math.abs(stop.color.r - 1) < 0.001 &&
        Math.abs(stop.color.g - 1) < 0.001 &&
        Math.abs(stop.color.b - 1) < 0.001,
    )
  );
}

function readQuarksColor(
  value: unknown,
  fallback: ParticleVFXEditorColor | null,
): ParticleVFXEditorColor {
  const color = readJsonObject(value);
  const r = readFiniteNumber(color?.r);
  const g = readFiniteNumber(color?.g);
  const b = readFiniteNumber(color?.b);
  const a = readFiniteNumber(color?.a);
  if (r === null || g === null || b === null) {
    return fallback ? { ...fallback } : { ...DEFAULT_START_COLOR };
  }
  return clampColor({ r, g, b, a: a ?? 1 });
}

function colorToJson(color: ParticleVFXEditorColor): JsonObject {
  const next = clampColor(color);
  return {
    r: roundEditorNumber(next.r),
    g: roundEditorNumber(next.g),
    b: roundEditorNumber(next.b),
    a: roundEditorNumber(next.a),
  };
}

function clampColor(color: ParticleVFXEditorColor): ParticleVFXEditorColor {
  return {
    r: clamp01(color.r),
    g: clamp01(color.g),
    b: clamp01(color.b),
    a: clamp01(color.a),
  };
}

function cloneColorStops(
  stops: readonly ParticleVFXEditorColorStop[],
): ParticleVFXEditorColorStop[] {
  return stops.map((stop) => ({
    position: stop.position,
    color: { ...stop.color },
  }));
}

function colorStop(
  position: number,
  r: number,
  g: number,
  b: number,
  a: number,
): ParticleVFXEditorColorStop {
  return { position, color: { r, g, b, a } };
}

function readGeneratorLabel(generator: JsonObject): string {
  return typeof generator.type === "string" ? generator.type : "Unsupported";
}

function findColorOverLifeBehavior(ps: JsonObject): JsonObject | null {
  const behaviors = Array.isArray(ps.behaviors) ? ps.behaviors : [];
  for (const behavior of behaviors) {
    const object = readJsonObject(behavior);
    if (object?.type === "ColorOverLife") return object;
  }
  return null;
}

function lerp(a: number, b: number, ratio: number): number {
  return a + (b - a) * ratio;
}

export function createColorOverLifeBehavior(): JsonObject {
  return colorOverLifeDraftToBehavior(createDefaultColorOverLifeDraft());
}

import rawCatalog from "@/assets/effects/scene-vfx/catalog.json";

import type {
  SceneBackgroundDirection,
  SceneBackgroundLineItem,
  SceneBackgroundMarqueeLayer,
  SceneBackgroundPatternKind,
  SceneBackgroundPatternLayer,
  SceneBackgroundSolidLayer,
  SceneFocusLinesAnimation,
  SceneFocusLinesRenderPlacement,
  SceneFocusLinesTarget,
  SceneFocusLinesTargetKind,
  SceneFocusLinesVFXEntry,
  SceneNormalizedRect,
  SceneVFXBaseEntry,
  SceneVFXEntry,
  SceneVFXKind,
  SceneBackgroundItemRotationMode,
  SceneBackgroundLayersVFXEntry,
  SceneBackgroundFlashLayer,
  SceneBackgroundGradientLayer,
  SceneBackgroundGradientType,
  SceneBackgroundScatterLayer,
  SceneBackgroundScatterPulse,
  SceneBackgroundScreenKind,
  SceneBackgroundScreenLayer,
  SceneBackgroundTileLayer,
} from "./types";
import {
  SCENE_BACKGROUND_DIRECTIONS,
  SCENE_BACKGROUND_GRADIENT_TYPES,
  SCENE_BACKGROUND_ITEM_ROTATION_MODES,
  SCENE_BACKGROUND_PATTERN_KINDS,
  SCENE_BACKGROUND_SCATTER_PULSES,
  SCENE_BACKGROUND_SCREEN_KINDS,
  SCENE_FOCUS_LINES_RENDER_PLACEMENTS,
  SCENE_FOCUS_LINES_TARGET_KINDS,
  SCENE_VFX_KINDS,
  isSceneLegacyEmojiItem,
} from "./types";
import { isRecord } from "@/lib/records";

type RawCatalogRecord = Record<string, unknown>;

type RawSceneVFXCatalog = {
  backgroundLayerPresets: Array<{
    presetId: string;
    entry: SceneBackgroundLayersVFXEntry;
  }>;
  focusLinePresets: Array<{
    presetId: string;
    entry: SceneFocusLinesVFXEntry;
  }>;
};

type RawSceneVFXBaseEntry = SceneVFXBaseEntry & {
  kind: SceneVFXKind;
};

export type SceneVFXCatalogBackgroundPresetId = string;
export type SceneVFXCatalogFocusLinesPresetId = string;

const CATALOG_VERSION = 1;

const SCENE_VFX_KIND_SET = createAllowedValueSet(SCENE_VFX_KINDS);
const SCENE_BACKGROUND_PATTERN_KIND_SET = createAllowedValueSet(
  SCENE_BACKGROUND_PATTERN_KINDS,
);
const SCENE_BACKGROUND_DIRECTION_SET = createAllowedValueSet(
  SCENE_BACKGROUND_DIRECTIONS,
);
const SCENE_BACKGROUND_ITEM_ROTATION_MODE_SET = createAllowedValueSet(
  SCENE_BACKGROUND_ITEM_ROTATION_MODES,
);
const SCENE_BACKGROUND_GRADIENT_TYPE_SET = createAllowedValueSet(
  SCENE_BACKGROUND_GRADIENT_TYPES,
);
const SCENE_BACKGROUND_SCREEN_KIND_SET = createAllowedValueSet(
  SCENE_BACKGROUND_SCREEN_KINDS,
);
const SCENE_BACKGROUND_SCATTER_PULSE_SET = createAllowedValueSet(
  SCENE_BACKGROUND_SCATTER_PULSES,
);
const SCENE_FOCUS_LINES_RENDER_PLACEMENT_SET = createAllowedValueSet(
  SCENE_FOCUS_LINES_RENDER_PLACEMENTS,
);
const SCENE_FOCUS_LINES_TARGET_KIND_SET = createAllowedValueSet(
  SCENE_FOCUS_LINES_TARGET_KINDS,
);
const SCENE_BACKGROUND_SVG_SRC_PREFIX = "/effects/scene-vfx/svg/";

function createAllowedValueSet<T extends string>(
  values: readonly T[],
): Set<string> {
  return new Set<string>(values);
}

function createError(context: string, message: string): Error {
  return new Error(`[SceneVFXCatalog] ${context}: ${message}`);
}

function readRecord(
  value: unknown,
  field: string,
  context: string,
): RawCatalogRecord {
  if (!isRecord(value)) {
    throw createError(context, `"${field}" must be an object.`);
  }
  return value;
}

function readArray(value: unknown, field: string, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw createError(context, `"${field}" must be an array.`);
  }
  return value;
}

function readString(value: unknown, field: string, context: string): string {
  if (typeof value !== "string") {
    throw createError(context, `"${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw createError(context, `"${field}" must not be empty.`);
  }
  return trimmed;
}

const SCENE_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/**
 * A Scene colour: six-digit hex only. Colours reach CSS gradients and SVG
 * paint, where any other text could name an external resource.
 */
function readSceneColor(
  value: unknown,
  field: string,
  context: string,
): string {
  const color = readString(value, field, context);
  if (!SCENE_COLOR_PATTERN.test(color))
    throw createError(context, `"${field}" must be a #rrggbb colour.`);
  return color;
}

function readFiniteNumber(
  value: unknown,
  field: string,
  context: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw createError(context, `"${field}" must be a finite number.`);
  }
  return value;
}

function readBoolean(value: unknown, field: string, context: string): boolean {
  if (typeof value !== "boolean") {
    throw createError(context, `"${field}" must be a boolean.`);
  }
  return value;
}

function readOptionalBoolean(
  value: unknown,
  field: string,
  context: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  return readBoolean(value, field, context);
}

function readOptionalNullableFiniteNumber(
  value: unknown,
  field: string,
  context: string,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return readFiniteNumber(value, field, context);
}

function readEnumValue<T extends string>(
  value: unknown,
  field: string,
  context: string,
  allowed: Set<string>,
): T {
  const parsed = readString(value, field, context);
  if (!allowed.has(parsed)) {
    throw createError(context, `"${field}" has unsupported value "${parsed}".`);
  }
  return parsed as T;
}

function readBaseEntry(
  value: unknown,
  expectedKind: SceneVFXKind,
  context: string,
): RawSceneVFXBaseEntry {
  const record = readRecord(value, "entry", context);
  const kind = readEnumValue<SceneVFXKind>(
    record.kind,
    "kind",
    context,
    SCENE_VFX_KIND_SET,
  );
  if (kind !== expectedKind) {
    throw createError(
      context,
      `"kind" must be "${expectedKind}", received "${kind}".`,
    );
  }

  const entry: RawSceneVFXBaseEntry = {
    id: readString(record.id, "id", context),
    label: readString(record.label, "label", context),
    kind,
    enabled: readBoolean(record.enabled, "enabled", context),
  };

  const durationMs = readOptionalNullableFiniteNumber(
    record.durationMs,
    "durationMs",
    context,
  );
  if (durationMs !== undefined) {
    entry.durationMs = durationMs;
  }

  const coverUiOverlays = readOptionalBoolean(
    record.coverUiOverlays,
    "coverUiOverlays",
    context,
  );
  if (coverUiOverlays !== undefined) {
    entry.coverUiOverlays = coverUiOverlays;
  }

  const dismissOnInput = readOptionalBoolean(
    record.dismissOnInput,
    "dismissOnInput",
    context,
  );
  if (dismissOnInput !== undefined) {
    entry.dismissOnInput = dismissOnInput;
  }
  if (record.sound !== undefined) {
    const sound = readRecord(record.sound, "sound", context);
    entry.sound = {
      onApply: readString(sound.onApply, "sound.onApply", context),
    };
  }

  return entry;
}

function readSceneBackgroundSvgSrc(
  value: unknown,
  field: string,
  context: string,
): string {
  const src = readString(value, field, context);
  if (
    !src.startsWith(SCENE_BACKGROUND_SVG_SRC_PREFIX) ||
    !src.endsWith(".svg") ||
    src.includes("..") ||
    src.includes("?") ||
    src.includes("#")
  ) {
    throw createError(
      context,
      `"${field}" must be a root-relative SVG path under "${SCENE_BACKGROUND_SVG_SRC_PREFIX}".`,
    );
  }
  return src;
}

function readSceneBackgroundLineItem(
  value: unknown,
  context: string,
): SceneBackgroundLineItem {
  const record = readRecord(value, "items[]", context);
  const kind = readEnumValue<SceneBackgroundLineItem["kind"]>(
    record.kind,
    "kind",
    context,
    new Set<string>(["png", "svg"]),
  );
  const base = {
    id: readString(record.id, "id", context),
    label: readString(record.label, "label", context),
  };
  if (kind === "png") {
    return { ...base, kind, src: readString(record.src, "src", context) };
  }
  return {
    ...base,
    kind,
    src: readSceneBackgroundSvgSrc(record.src, "src", context),
  };
}

/**
 * Read a marquee or scatter item list. A legacy Twemoji item (Animama no
 * longer provides Twemoji) is skipped, so a Scene saved with one plays
 * without it and requests no image for it.
 */
function readSceneBackgroundLineItems(
  value: unknown,
  field: string,
  context: string,
): SceneBackgroundLineItem[] {
  return readArray(value, field, context).flatMap((item, index) =>
    isSceneLegacyEmojiItem(item)
      ? []
      : [readSceneBackgroundLineItem(item, `${context}.${field}[${index}]`)],
  );
}

function readSceneBackgroundSolidLayer(
  value: unknown,
  context: string,
): SceneBackgroundSolidLayer {
  const record = readRecord(value, "solid", context);
  return {
    enabled: readBoolean(record.enabled, "solid.enabled", context),
    color: readSceneColor(record.color, "solid.color", context),
  };
}

function readSceneBackgroundPatternLayer(
  value: unknown,
  context: string,
): SceneBackgroundPatternLayer {
  const record = readRecord(value, "pattern", context);
  return {
    enabled: readBoolean(record.enabled, "pattern.enabled", context),
    pattern: readEnumValue<SceneBackgroundPatternKind>(
      record.pattern,
      "pattern.pattern",
      context,
      SCENE_BACKGROUND_PATTERN_KIND_SET,
    ),
    color: readSceneColor(record.color, "pattern.color", context),
    size: readFiniteNumber(record.size, "pattern.size", context),
    spacing: readFiniteNumber(record.spacing, "pattern.spacing", context),
    opacity: readFiniteNumber(record.opacity, "pattern.opacity", context),
  };
}

/**
 * A bundled preset's marquee. The bundled catalog has no line items, so each
 * preset's marquee starts empty; the creator adds stickers or images to it.
 */
function readSceneBackgroundMarqueeLayer(
  value: unknown,
  context: string,
): SceneBackgroundMarqueeLayer {
  const record = readRecord(value, "marquee", context);
  return {
    enabled: readBoolean(record.enabled, "marquee.enabled", context),
    items: [],
    itemSize: readFiniteNumber(record.itemSize, "marquee.itemSize", context),
    gap: readFiniteNumber(record.gap, "marquee.gap", context),
    rowGap: readFiniteNumber(record.rowGap, "marquee.rowGap", context),
    direction: readEnumValue<SceneBackgroundDirection>(
      record.direction,
      "marquee.direction",
      context,
      SCENE_BACKGROUND_DIRECTION_SET,
    ),
    itemRotationMode: readEnumValue<SceneBackgroundItemRotationMode>(
      record.itemRotationMode,
      "marquee.itemRotationMode",
      context,
      SCENE_BACKGROUND_ITEM_ROTATION_MODE_SET,
    ),
    itemRotationOffsetDeg: readFiniteNumber(
      record.itemRotationOffsetDeg,
      "marquee.itemRotationOffsetDeg",
      context,
    ),
    speedPxPerSec: readFiniteNumber(
      record.speedPxPerSec,
      "marquee.speedPxPerSec",
      context,
    ),
    opacity: readFiniteNumber(record.opacity, "marquee.opacity", context),
  };
}

function readSceneBackgroundGradientLayer(
  value: unknown,
  context: string,
): SceneBackgroundGradientLayer {
  const record = readRecord(value, "gradient", context);
  return {
    enabled: readBoolean(record.enabled, "gradient.enabled", context),
    type: readEnumValue<SceneBackgroundGradientType>(
      record.type,
      "gradient.type",
      context,
      SCENE_BACKGROUND_GRADIENT_TYPE_SET,
    ),
    angleDeg: readFiniteNumber(record.angleDeg, "gradient.angleDeg", context),
    centerX: readFiniteNumber(record.centerX, "gradient.centerX", context),
    centerY: readFiniteNumber(record.centerY, "gradient.centerY", context),
    stops: readArray(record.stops, "gradient.stops", context).map(
      (stop, index) => {
        const field = `gradient.stops[${index}]`;
        const stopRecord = readRecord(stop, field, context);
        return {
          color: readSceneColor(stopRecord.color, `${field}.color`, context),
          position: readFiniteNumber(
            stopRecord.position,
            `${field}.position`,
            context,
          ),
        };
      },
    ),
  };
}

function readSceneBackgroundTileLayer(
  value: unknown,
  context: string,
): SceneBackgroundTileLayer {
  const record = readRecord(value, "tile", context);
  return {
    enabled: readBoolean(record.enabled, "tile.enabled", context),
    src: readString(record.src, "tile.src", context),
    size: readFiniteNumber(record.size, "tile.size", context),
    opacity: readFiniteNumber(record.opacity, "tile.opacity", context),
    direction: readEnumValue<SceneBackgroundDirection>(
      record.direction,
      "tile.direction",
      context,
      SCENE_BACKGROUND_DIRECTION_SET,
    ),
    speedPxPerSec: readFiniteNumber(
      record.speedPxPerSec,
      "tile.speedPxPerSec",
      context,
    ),
  };
}

function readSceneBackgroundScreenLayer(
  value: unknown,
  context: string,
): SceneBackgroundScreenLayer {
  const record = readRecord(value, "screen", context);
  const number = (field: string) =>
    readFiniteNumber(record[field], `screen.${field}`, context);
  const common = {
    enabled: readBoolean(record.enabled, "screen.enabled", context),
    color: readSceneColor(record.color, "screen.color", context),
    opacity: number("opacity"),
    count: number("count"),
    seed: number("seed"),
  };
  const kind = readEnumValue<SceneBackgroundScreenKind>(
    record.kind,
    "screen.kind",
    context,
    SCENE_BACKGROUND_SCREEN_KIND_SET,
  );
  if (kind === "rays")
    return {
      ...common,
      kind,
      centerX: number("centerX"),
      centerY: number("centerY"),
      spiky: readBoolean(record.spiky, "screen.spiky", context),
      turnSeconds: number("turnSeconds"),
      throbPerSec: number("throbPerSec"),
    };
  return {
    ...common,
    kind,
    minLength: number("minLength"),
    maxLength: number("maxLength"),
    minWidthPx: number("minWidthPx"),
    maxWidthPx: number("maxWidthPx"),
    swaySeconds: number("swaySeconds"),
  };
}

function readSceneBackgroundScatterLayer(
  value: unknown,
  context: string,
): SceneBackgroundScatterLayer {
  const record = readRecord(value, "scatter", context);
  const number = (field: string) =>
    readFiniteNumber(record[field], field, context);
  const boolean = (field: string) => readBoolean(record[field], field, context);
  return {
    enabled: boolean("enabled"),
    items: readSceneBackgroundLineItems(record.items, "items", context),
    count: number("count"),
    seed: number("seed"),
    minSize: number("minSize"),
    maxSize: number("maxSize"),
    minRotationDeg: number("minRotationDeg"),
    maxRotationDeg: number("maxRotationDeg"),
    minOpacity: number("minOpacity"),
    maxOpacity: number("maxOpacity"),
    regionTop: number("regionTop"),
    regionBottom: number("regionBottom"),
    keepFaceClear: boolean("keepFaceClear"),
    direction: readEnumValue<SceneBackgroundDirection>(
      record.direction,
      "direction",
      context,
      SCENE_BACKGROUND_DIRECTION_SET,
    ),
    speedPxPerSec: number("speedPxPerSec"),
    minSpinDegPerSec: number("minSpinDegPerSec"),
    maxSpinDegPerSec: number("maxSpinDegPerSec"),
    alternateSpin: boolean("alternateSpin"),
    pulse: readEnumValue<SceneBackgroundScatterPulse>(
      record.pulse,
      "pulse",
      context,
      SCENE_BACKGROUND_SCATTER_PULSE_SET,
    ),
  };
}

function readSceneBackgroundFlashLayer(
  value: unknown,
  context: string,
): SceneBackgroundFlashLayer {
  const record = readRecord(value, "flash", context);
  return {
    enabled: readBoolean(record.enabled, "flash.enabled", context),
    color: readSceneColor(record.color, "flash.color", context),
    durationMs: readFiniteNumber(
      record.durationMs,
      "flash.durationMs",
      context,
    ),
  };
}

/** The optional background layers (C1–C6) a runtime entry carries. */
function readSceneBackgroundOptionalLayers(
  record: RawCatalogRecord,
  context: string,
): Pick<
  SceneBackgroundLayersVFXEntry,
  "gradient" | "tile" | "screen" | "scatters" | "flash"
> {
  return {
    ...(record.gradient === undefined
      ? {}
      : {
          gradient: readSceneBackgroundGradientLayer(record.gradient, context),
        }),
    ...(record.tile === undefined
      ? {}
      : { tile: readSceneBackgroundTileLayer(record.tile, context) }),
    ...(record.screen === undefined
      ? {}
      : { screen: readSceneBackgroundScreenLayer(record.screen, context) }),
    ...(record.scatters === undefined
      ? {}
      : {
          scatters: readArray(record.scatters, "scatters", context).map(
            (layer, index) =>
              readSceneBackgroundScatterLayer(
                layer,
                `${context}.scatters[${index}]`,
              ),
          ),
        }),
    ...(record.flash === undefined
      ? {}
      : { flash: readSceneBackgroundFlashLayer(record.flash, context) }),
  };
}

function readSceneBackgroundPreset(
  value: unknown,
  index: number,
): { presetId: string; entry: SceneBackgroundLayersVFXEntry } {
  const context = `backgroundLayerPresets[${index}]`;
  const record = readRecord(value, "backgroundLayerPresets[]", context);
  const presetId = readString(record.presetId, "presetId", context);
  const entryRecord = readRecord(record.entry, "entry", context);
  const base = readBaseEntry(entryRecord, "background_layers", context);
  const marquee = readSceneBackgroundMarqueeLayer(
    entryRecord.marquee,
    `${context}.entry`,
  );

  return {
    presetId,
    entry: {
      ...base,
      kind: "background_layers",
      solid: readSceneBackgroundSolidLayer(
        entryRecord.solid,
        `${context}.entry`,
      ),
      pattern: readSceneBackgroundPatternLayer(
        entryRecord.pattern,
        `${context}.entry`,
      ),
      marquee,
    },
  };
}

function readSceneNormalizedRect(
  value: unknown,
  context: string,
): SceneNormalizedRect {
  const record = readRecord(value, "target.rect", context);
  return {
    x: readFiniteNumber(record.x, "target.rect.x", context),
    y: readFiniteNumber(record.y, "target.rect.y", context),
    width: readFiniteNumber(record.width, "target.rect.width", context),
    height: readFiniteNumber(record.height, "target.rect.height", context),
  };
}

function readSceneFocusLinesTarget(
  value: unknown,
  context: string,
): SceneFocusLinesTarget {
  const record = readRecord(value, "target", context);
  const kind = readEnumValue<SceneFocusLinesTargetKind>(
    record.kind,
    "target.kind",
    context,
    SCENE_FOCUS_LINES_TARGET_KIND_SET,
  );

  if (kind === "manual_box") {
    return {
      kind,
      rect: readSceneNormalizedRect(record.rect, context),
    };
  }

  return {
    kind,
    paddingXPx: readFiniteNumber(
      record.paddingXPx,
      "target.paddingXPx",
      context,
    ),
    paddingYPx: readFiniteNumber(
      record.paddingYPx,
      "target.paddingYPx",
      context,
    ),
  };
}

function readSceneFocusLinesAnimation(
  value: unknown,
  context: string,
): SceneFocusLinesAnimation {
  const record = readRecord(value, "animation", context);
  return {
    minVisibleMs: readFiniteNumber(
      record.minVisibleMs,
      "animation.minVisibleMs",
      context,
    ),
    maxVisibleMs: readFiniteNumber(
      record.maxVisibleMs,
      "animation.maxVisibleMs",
      context,
    ),
    minHiddenMs: readFiniteNumber(
      record.minHiddenMs,
      "animation.minHiddenMs",
      context,
    ),
    maxHiddenMs: readFiniteNumber(
      record.maxHiddenMs,
      "animation.maxHiddenMs",
      context,
    ),
    opacityJitter: readFiniteNumber(
      record.opacityJitter,
      "animation.opacityJitter",
      context,
    ),
  };
}

function readSceneFocusLinePreset(
  value: unknown,
  index: number,
): { presetId: string; entry: SceneFocusLinesVFXEntry } {
  const context = `focusLinePresets[${index}]`;
  const record = readRecord(value, "focusLinePresets[]", context);
  const presetId = readString(record.presetId, "presetId", context);
  const entryRecord = readRecord(record.entry, "entry", context);
  const base = readBaseEntry(entryRecord, "focus_lines", context);
  const seed = readOptionalNullableFiniteNumber(
    entryRecord.seed,
    "seed",
    `${context}.entry`,
  );
  const entry: SceneFocusLinesVFXEntry = {
    ...base,
    kind: "focus_lines",
    renderPlacement: readEnumValue<SceneFocusLinesRenderPlacement>(
      entryRecord.renderPlacement,
      "renderPlacement",
      `${context}.entry`,
      SCENE_FOCUS_LINES_RENDER_PLACEMENT_SET,
    ),
    lineCount: readFiniteNumber(
      entryRecord.lineCount,
      "lineCount",
      `${context}.entry`,
    ),
    color: readSceneColor(entryRecord.color, "color", `${context}.entry`),
    opacity: readFiniteNumber(
      entryRecord.opacity,
      "opacity",
      `${context}.entry`,
    ),
    baseThicknessPx: readFiniteNumber(
      entryRecord.baseThicknessPx,
      "baseThicknessPx",
      `${context}.entry`,
    ),
    thicknessVariationPx: readFiniteNumber(
      entryRecord.thicknessVariationPx,
      "thicknessVariationPx",
      `${context}.entry`,
    ),
    lengthVariation: readFiniteNumber(
      entryRecord.lengthVariation,
      "lengthVariation",
      `${context}.entry`,
    ),
    overscanPx: readFiniteNumber(
      entryRecord.overscanPx,
      "overscanPx",
      `${context}.entry`,
    ),
    target: readSceneFocusLinesTarget(entryRecord.target, `${context}.entry`),
    animation: readSceneFocusLinesAnimation(
      entryRecord.animation,
      `${context}.entry`,
    ),
  };

  if (seed !== undefined) {
    entry.seed = seed;
  }

  return { presetId, entry };
}

function buildPresetMap<TEntry>(
  presets: Array<{ presetId: string; entry: TEntry }>,
  context: string,
): Map<string, TEntry> {
  const presetById = new Map<string, TEntry>();
  for (const preset of presets) {
    if (presetById.has(preset.presetId)) {
      throw createError(context, `duplicate preset id "${preset.presetId}".`);
    }
    presetById.set(preset.presetId, preset.entry);
  }
  return presetById;
}

function readSceneVFXCatalog(value: unknown): RawSceneVFXCatalog {
  const catalog = readRecord(value, "catalog", "catalog");
  const version = readFiniteNumber(catalog.version, "version", "catalog");
  if (version !== CATALOG_VERSION) {
    throw createError(
      "catalog",
      `"version" must be ${CATALOG_VERSION}, received ${version}.`,
    );
  }

  return {
    backgroundLayerPresets: readArray(
      catalog.backgroundLayerPresets,
      "backgroundLayerPresets",
      "catalog",
    ).map((preset, index) => readSceneBackgroundPreset(preset, index)),
    focusLinePresets: readArray(
      catalog.focusLinePresets,
      "focusLinePresets",
      "catalog",
    ).map((preset, index) => readSceneFocusLinePreset(preset, index)),
  };
}

function cloneSceneBackgroundLineItem<TItem extends SceneBackgroundLineItem>(
  item: TItem,
): TItem {
  return {
    ...item,
  };
}

function cloneSceneBackgroundLayersVFXEntry(
  entry: SceneBackgroundLayersVFXEntry,
): SceneBackgroundLayersVFXEntry {
  return {
    ...entry,
    solid: {
      ...entry.solid,
    },
    pattern: {
      ...entry.pattern,
    },
    marquee: {
      ...entry.marquee,
      items: entry.marquee.items.map(cloneSceneBackgroundLineItem),
    },
  };
}

function cloneSceneFocusLinesTarget(
  target: SceneFocusLinesTarget,
): SceneFocusLinesTarget {
  if (target.kind === "manual_box") {
    return {
      kind: "manual_box",
      rect: {
        ...target.rect,
      },
    };
  }

  return {
    kind: "avatar_face",
    paddingXPx: target.paddingXPx,
    paddingYPx: target.paddingYPx,
  };
}

function cloneSceneFocusLinesVFXEntry(
  entry: SceneFocusLinesVFXEntry,
): SceneFocusLinesVFXEntry {
  return {
    ...entry,
    target: cloneSceneFocusLinesTarget(entry.target),
    animation: {
      ...entry.animation,
    },
  };
}

const SCENE_VFX_CATALOG = readSceneVFXCatalog(rawCatalog);
const BACKGROUND_LAYER_PRESET_BY_ID = buildPresetMap(
  SCENE_VFX_CATALOG.backgroundLayerPresets,
  "backgroundLayerPresets",
);
const FOCUS_LINE_PRESET_BY_ID = buildPresetMap(
  SCENE_VFX_CATALOG.focusLinePresets,
  "focusLinePresets",
);

export function getSceneBackgroundLayerPresetIds(): SceneVFXCatalogBackgroundPresetId[] {
  return SCENE_VFX_CATALOG.backgroundLayerPresets.map(
    (preset) => preset.presetId,
  );
}

export function getSceneBackgroundLayerPresetById(
  presetId: SceneVFXCatalogBackgroundPresetId,
): SceneBackgroundLayersVFXEntry | null {
  const preset = BACKGROUND_LAYER_PRESET_BY_ID.get(presetId);
  return preset ? cloneSceneBackgroundLayersVFXEntry(preset) : null;
}

export function getSceneFocusLinePresetIds(): SceneVFXCatalogFocusLinesPresetId[] {
  return SCENE_VFX_CATALOG.focusLinePresets.map((preset) => preset.presetId);
}

export function getSceneFocusLinePresetById(
  presetId: SceneVFXCatalogFocusLinesPresetId,
): SceneFocusLinesVFXEntry | null {
  const preset = FOCUS_LINE_PRESET_BY_ID.get(presetId);
  return preset ? cloneSceneFocusLinesVFXEntry(preset) : null;
}

/** Parse one fully expanded code-shipped or private Scene VFX entry. */
export function parseSceneVFXEntry(value: unknown): SceneVFXEntry {
  const record = readRecord(value, "entry", "runtime entry");
  const kind = readEnumValue<SceneVFXKind>(
    record.kind,
    "kind",
    "runtime entry",
    SCENE_VFX_KIND_SET,
  );
  const base = readBaseEntry(record, kind, "runtime entry");
  const soundRecord =
    record.sound === undefined
      ? null
      : readRecord(record.sound, "sound", "runtime entry");
  const sound = soundRecord
    ? {
        onApply: readString(
          soundRecord.onApply,
          "sound.onApply",
          "runtime entry",
        ),
      }
    : undefined;
  if (kind === "background_layers") {
    const marquee = readRecord(record.marquee, "marquee", "runtime entry");
    return {
      ...base,
      kind,
      ...(sound ? { sound } : {}),
      solid: readSceneBackgroundSolidLayer(record.solid, "runtime entry"),
      pattern: readSceneBackgroundPatternLayer(record.pattern, "runtime entry"),
      ...readSceneBackgroundOptionalLayers(record, "runtime entry"),
      marquee: {
        enabled: readBoolean(
          marquee.enabled,
          "marquee.enabled",
          "runtime entry",
        ),
        items: readSceneBackgroundLineItems(
          marquee.items,
          "marquee.items",
          "runtime entry",
        ),
        itemSize: readFiniteNumber(
          marquee.itemSize,
          "marquee.itemSize",
          "runtime entry",
        ),
        gap: readFiniteNumber(marquee.gap, "marquee.gap", "runtime entry"),
        rowGap: readFiniteNumber(
          marquee.rowGap,
          "marquee.rowGap",
          "runtime entry",
        ),
        direction: readEnumValue<SceneBackgroundDirection>(
          marquee.direction,
          "marquee.direction",
          "runtime entry",
          SCENE_BACKGROUND_DIRECTION_SET,
        ),
        itemRotationMode: readEnumValue<SceneBackgroundItemRotationMode>(
          marquee.itemRotationMode,
          "marquee.itemRotationMode",
          "runtime entry",
          SCENE_BACKGROUND_ITEM_ROTATION_MODE_SET,
        ),
        itemRotationOffsetDeg: readFiniteNumber(
          marquee.itemRotationOffsetDeg,
          "marquee.itemRotationOffsetDeg",
          "runtime entry",
        ),
        speedPxPerSec: readFiniteNumber(
          marquee.speedPxPerSec,
          "marquee.speedPxPerSec",
          "runtime entry",
        ),
        opacity: readFiniteNumber(
          marquee.opacity,
          "marquee.opacity",
          "runtime entry",
        ),
      },
    };
  }
  const seed = readOptionalNullableFiniteNumber(
    record.seed,
    "seed",
    "runtime entry",
  );
  return {
    ...base,
    kind,
    ...(sound ? { sound } : {}),
    renderPlacement: readEnumValue<SceneFocusLinesRenderPlacement>(
      record.renderPlacement,
      "renderPlacement",
      "runtime entry",
      SCENE_FOCUS_LINES_RENDER_PLACEMENT_SET,
    ),
    lineCount: readFiniteNumber(record.lineCount, "lineCount", "runtime entry"),
    color: readSceneColor(record.color, "color", "runtime entry"),
    opacity: readFiniteNumber(record.opacity, "opacity", "runtime entry"),
    baseThicknessPx: readFiniteNumber(
      record.baseThicknessPx,
      "baseThicknessPx",
      "runtime entry",
    ),
    thicknessVariationPx: readFiniteNumber(
      record.thicknessVariationPx,
      "thicknessVariationPx",
      "runtime entry",
    ),
    lengthVariation: readFiniteNumber(
      record.lengthVariation,
      "lengthVariation",
      "runtime entry",
    ),
    overscanPx: readFiniteNumber(
      record.overscanPx,
      "overscanPx",
      "runtime entry",
    ),
    target: readSceneFocusLinesTarget(record.target, "runtime entry"),
    animation: readSceneFocusLinesAnimation(record.animation, "runtime entry"),
    ...(seed !== undefined ? { seed } : {}),
  };
}

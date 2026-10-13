import { getI18n } from "react-i18next";

import type {
  PyContentDependency,
  PyExactContentSource,
} from "@/lib/content/catalogTypes";
import {
  SCENE_IMAGE_LIMITS,
  inspectEffectArt,
} from "@/lib/effects/effectArtLimits";
import { failureLine, WordedError } from "@/lib/errors/apiError";
import {
  sceneDefinitionLimitIssues,
  type SceneLimitIssue,
} from "@/lib/scene-vfx/limits";
import { sceneEntryFromDefinition } from "@/lib/scene-vfx/sceneDefinition";
import type { SceneVFXEntry } from "@/lib/scene-vfx/types";
import {
  createDefaultSceneEffectDocument,
  defaultSceneOptionalLayers,
  sceneEffectTemplate,
} from "./defaults";
import {
  SCENE_EFFECT_EDITOR_SCHEMA,
  type SceneEffectEditorAction,
  type SceneEffectEditorDocument,
  type SceneEffectEditorExport,
  type SceneEffectEditorImage,
  type SceneEffectEditorImageResource,
  type SceneEffectEditorMarqueeItem,
  type SceneEffectEditorSound,
  type SceneEffectTemplateId,
  type SceneEffectValidationIssue,
} from "./types";
import { formattersForLanguage } from "@animama/product-ui/i18n";

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
export const SCENE_EFFECT_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
const MIB = 1024 * 1024;

export function sceneEffectEditorReducer(
  state: SceneEffectEditorDocument,
  action: SceneEffectEditorAction,
): SceneEffectEditorDocument {
  if (action.type === "replace")
    return cloneSceneEffectDocument(action.document);
  if (action.type === "set-kind") {
    return {
      ...state,
      kind: action.kind,
      dismissOnInput: action.kind === "background_layers",
    };
  }
  if (action.type === "patch") return { ...state, ...action.patch };
  if (action.type === "patch-background")
    return { ...state, background: { ...state.background, ...action.patch } };
  if (action.type === "patch-solid")
    return {
      ...state,
      background: {
        ...state.background,
        solid: { ...state.background.solid, ...action.patch },
      },
    };
  if (action.type === "patch-pattern")
    return {
      ...state,
      background: {
        ...state.background,
        pattern: { ...state.background.pattern, ...action.patch },
      },
    };
  if (action.type === "patch-marquee")
    return {
      ...state,
      background: {
        ...state.background,
        marquee: { ...state.background.marquee, ...action.patch },
      },
    };
  if (action.type === "set-marquee-items")
    return {
      ...state,
      background: {
        ...state.background,
        marquee: { ...state.background.marquee, items: action.items },
      },
    };
  if (action.type === "patch-focus")
    return { ...state, focus: { ...state.focus, ...action.patch } };
  if (action.type === "set-focus-target")
    return { ...state, focus: { ...state.focus, target: action.target } };
  return {
    ...state,
    focus: {
      ...state.focus,
      animation: { ...state.focus.animation, ...action.patch },
    },
  };
}

export function cloneSceneEffectDocument(
  document: SceneEffectEditorDocument,
): SceneEffectEditorDocument {
  return structuredClone(document);
}

/**
 * A document from before the optional layers (C1–C6), from browser recovery
 * or an editor export, gains them switched off. Layers it has keep their
 * place, so a current document's JSON is unchanged (restored recovery is
 * compared with the export text).
 */
export function normalizeSceneEffectDocument(
  document: SceneEffectEditorDocument,
): SceneEffectEditorDocument {
  const optional = defaultSceneOptionalLayers();
  const background = document.background;
  return {
    ...document,
    background: {
      ...background,
      gradient: background.gradient ?? optional.gradient,
      tile: background.tile ?? optional.tile,
      screen: background.screen ?? optional.screen,
      scatters: background.scatters ?? optional.scatters,
      flash: background.flash ?? optional.flash,
    },
  };
}

export function applySceneEffectTemplate(
  document: SceneEffectEditorDocument,
  templateId: SceneEffectTemplateId,
): SceneEffectEditorDocument {
  const template = sceneEffectTemplate(templateId);
  return {
    ...document,
    kind: template.kind,
    dismissOnInput: template.kind === "background_layers",
    background: template.background,
    focus: template.focus,
  };
}

/** The extension a Scene image keeps: its own, so name and bytes agree. */
const SCENE_IMAGE_EXTENSIONS: Record<string, string> = {
  ".png": ".png",
  ".jpg": ".jpg",
  ".jpeg": ".jpg",
  ".webp": ".webp",
  ".svg": ".svg",
};

/** The extension each accepted Scene image type is saved with. */
const SCENE_IMAGE_TYPE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

/**
 * A safe logical name for a chosen image. The extension follows `contentType`
 * when given (the type its bytes were read as), else the file's own, so a
 * saved image's name and bytes agree.
 */
export function canonicalSceneEffectImageName(
  filename: string,
  contentType?: string,
): string {
  const basename =
    filename.replaceAll("\\", "/").split("/").at(-1) ?? "scene-item";
  const stem =
    basename
      .replace(/\.[^.]+$/, "")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "scene-item";
  const extension =
    (contentType && SCENE_IMAGE_TYPE_EXTENSIONS[contentType]) ??
    SCENE_IMAGE_EXTENSIONS[
      basename.match(/\.[^.]+$/)?.[0].toLowerCase() ?? ""
    ] ??
    ".png";
  return `${stem}${extension}`;
}

/**
 * Check a chosen Scene image before it is decoded, against the shared limits
 * the backend applies at Save: its type, bytes, and for a raster image its
 * format and size from the file header. Returns the content type its bytes
 * are (whatever the file claims), or why it is refused.
 */
export async function inspectSceneEffectImage(
  file: Blob,
): Promise<{ ok: true; contentType: string } | { ok: false; message: string }> {
  const t = getI18n().getFixedT(null, "effects");
  if (!SCENE_EFFECT_IMAGE_TYPES.has(file.type))
    return { ok: false, message: t("scene.image.typeInvalid") };
  const tooLarge = t("scene.image.tooLarge", {
    size: SCENE_IMAGE_LIMITS.bytes / MIB,
  });
  if (file.type === "image/svg+xml")
    return file.size > SCENE_IMAGE_LIMITS.bytes
      ? { ok: false, message: tooLarge }
      : { ok: true, contentType: file.type };
  const inspection = await inspectEffectArt(file, SCENE_IMAGE_LIMITS);
  if (inspection.ok)
    return { ok: true, contentType: `image/${inspection.format}` };
  return {
    ok: false,
    message:
      inspection.reason === "bytes"
        ? tooLarge
        : inspection.reason === "format"
          ? t("scene.image.unreadable")
          : t("scene.image.dimensionsTooLarge", {
              size: SCENE_IMAGE_LIMITS.dimension,
            }),
  };
}

/** Where a chosen image goes: a marquee or scatter item, or the tile. */
export type SceneEffectImageTarget =
  | { kind: "marquee" }
  | { kind: "scatter"; index: number }
  | { kind: "tile" };

/** The label an image item takes by default: its file name without extension. */
export function sceneEffectImageItemLabel(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

/**
 * Add a chosen image to `target`, switching that layer on. The new item is
 * labelled `label` (a sticker's label), by default the file's name.
 */
export function addSceneEffectImage(
  document: SceneEffectEditorDocument,
  image: SceneEffectEditorImage,
  target: SceneEffectImageTarget,
  label?: string,
): SceneEffectEditorDocument {
  const background = document.background;
  const item: SceneEffectEditorMarqueeItem = {
    id: `private-${crypto.randomUUID().slice(0, 8)}`,
    kind: "image",
    label: label ?? sceneEffectImageItemLabel(image.originalName),
    image,
  };
  if (target.kind === "tile")
    return {
      ...document,
      background: {
        ...background,
        tile: { ...background.tile, enabled: true, image },
      },
    };
  if (target.kind === "scatter")
    return {
      ...document,
      background: {
        ...background,
        scatters: background.scatters.map((layer, index) =>
          index === target.index
            ? { ...layer, enabled: true, items: [...layer.items, item] }
            : layer,
        ),
      },
    };
  return {
    ...document,
    background: {
      ...background,
      marquee: {
        ...background.marquee,
        enabled: true,
        items: [...background.marquee.items, item],
      },
    },
  };
}

/** Give every use of an image (by logical name) newly chosen bytes. */
export function replaceSceneEffectImage(
  document: SceneEffectEditorDocument,
  image: SceneEffectEditorImage,
): SceneEffectEditorDocument {
  const items = (list: SceneEffectEditorMarqueeItem[]) =>
    list.map((item) =>
      item.kind === "image" && item.image.logicalName === image.logicalName
        ? { ...item, image }
        : item,
    );
  const background = document.background;
  return {
    ...document,
    background: {
      ...background,
      marquee: {
        ...background.marquee,
        items: items(background.marquee.items),
      },
      scatters: background.scatters.map((layer) => ({
        ...layer,
        items: items(layer.items),
      })),
      tile:
        background.tile.image?.logicalName === image.logicalName
          ? { ...background.tile, image }
          : background.tile,
    },
  };
}

export function uniqueSceneEffectImageName(
  filename: string,
  existingNames: Iterable<string>,
): string {
  const canonical = canonicalSceneEffectImageName(filename);
  const existing = new Set(existingNames);
  if (!existing.has(canonical)) return canonical;
  const extension = canonical.match(/\.[^.]+$/)?.[0] ?? ".png";
  const stem = canonical.slice(0, -extension.length);
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${stem}-${crypto.randomUUID().slice(0, 8)}${extension}`;
}

export function sceneEffectDefinition(
  document: SceneEffectEditorDocument,
): Record<string, unknown> {
  const common = {
    schema: "animama/scene-effect/1",
    kind: document.kind,
    durationMs: document.durationMs,
    coverUiOverlays: document.coverUiOverlays,
    dismissOnInput: document.dismissOnInput,
    ...(document.sound ? { soundAlias: document.sound.alias } : {}),
  };
  if (document.kind === "background_layers") {
    const { solid, pattern, marquee, gradient, tile, screen, scatters, flash } =
      document.background;
    const { image: tileImage, ...tileSettings } = tile;
    return {
      ...common,
      solid: { ...solid },
      pattern: { ...pattern },
      marquee: { ...marquee, items: marquee.items.map(definitionItem) },
      gradient: structuredClone(gradient),
      // A tile names its image; without one there is no tile to save.
      ...(tileImage
        ? { tile: { ...tileSettings, image: tileImage.logicalName } }
        : {}),
      screen: { ...screen },
      scatters: scatters.map((layer) => ({
        ...layer,
        items: layer.items.map(definitionItem),
      })),
      flash: { ...flash },
    };
  }
  return {
    ...common,
    renderPlacement: document.focus.renderPlacement,
    lineCount: document.focus.lineCount,
    color: document.focus.color,
    opacity: document.focus.opacity,
    baseThicknessPx: document.focus.baseThicknessPx,
    thicknessVariationPx: document.focus.thicknessVariationPx,
    lengthVariation: document.focus.lengthVariation,
    overscanPx: document.focus.overscanPx,
    target: structuredClone(document.focus.target),
    animation: { ...document.focus.animation },
    seed: document.focus.seed,
  };
}

/** The runtime entry the preview draws, with each image at its URL. */
export function sceneEffectRuntimeEntry(
  document: SceneEffectEditorDocument,
  imageUrls: ReadonlyMap<string, string>,
): SceneVFXEntry {
  for (const image of sceneEffectImageMetadata(document))
    if (!imageUrls.get(image.logicalName)) {
      const t = getI18n().getFixedT(null, "effects");
      throw new WordedError(
        t("scene.validation.reselectForPreview", { file: image.originalName }),
      );
    }
  return sceneEntryFromDefinition(
    sceneEffectDefinition(document),
    {
      id: "scene-effect-editor-preview",
      label: document.name || "Scene Effect preview",
    },
    (logicalName) => imageUrls.get(logicalName),
    document.sound ? { sound: { onApply: document.sound.alias } } : {},
  ).entry;
}

export function sceneEffectDependencies(
  document: SceneEffectEditorDocument,
): PyContentDependency[] {
  return document.sound
    ? [
        {
          alias: document.sound.alias,
          content_type: "sound_effect",
          source: document.sound.source,
          config: {},
        },
      ]
    : [];
}

/** The private images a background shows: marquee and scatter items, the tile. */
export function sceneEffectImageMetadata(
  document: SceneEffectEditorDocument,
): SceneEffectEditorImage[] {
  if (document.kind !== "background_layers") return [];
  const byName = new Map<string, SceneEffectEditorImage>();
  const { marquee, scatters, tile } = document.background;
  for (const item of [
    ...marquee.items,
    ...scatters.flatMap((layer) => layer.items),
  ]) {
    if (item.kind === "image") byName.set(item.image.logicalName, item.image);
  }
  if (tile.image) byName.set(tile.image.logicalName, tile.image);
  return [...byName.values()];
}

export function validateSceneEffectDocument(
  document: SceneEffectEditorDocument,
  resources: readonly SceneEffectEditorImageResource[],
): SceneEffectValidationIssue[] {
  const t = getI18n().getFixedT(null, "effects");
  const issues: SceneEffectValidationIssue[] = [];
  if (document.name.trim().length > 120)
    issue(issues, "name", t("scene.validation.nameTooLong", { max: 120 }));
  if (document.description.length > 2000)
    issue(
      issues,
      "description",
      t("scene.validation.descriptionTooLong", { max: 2000 }),
    );
  if (
    document.durationMs !== null &&
    (!Number.isInteger(document.durationMs) ||
      document.durationMs < 100 ||
      document.durationMs > 30_000)
  )
    issue(
      issues,
      "duration",
      t("scene.validation.duration", { min: 0.1, max: 30 }),
    );
  if (document.sound && !isExactContentSource(document.sound.source))
    issue(issues, "sound", t("creator.validation.reselectSound"));

  // Ranges, counts and legacy Twemoji items, as the backend checks them at
  // Save (the duration is reported above in the creator's own terms).
  for (const limit of sceneDefinitionLimitIssues(
    sceneEffectDefinition(document),
  ))
    if (limit.field !== "durationMs")
      issue(issues, limit.field, sceneLimitMessage(limit));
  if (document.kind === "background_layers") {
    validateBackground(document, resources, issues);
  } else {
    validateFocus(document, issues);
    if (resources.length > 0)
      issues.push({
        field: "images",
        severity: "warning",
        message: t("scene.validation.unusedImages"),
      });
  }
  try {
    const urls = new Map(
      sceneEffectImageMetadata(document).map((image) => [
        image.logicalName,
        `blob:scene-editor-${image.logicalName}`,
      ]),
    );
    sceneEffectRuntimeEntry(document, urls);
  } catch (error) {
    issue(
      issues,
      "definition",
      failureLine(error, t("scene.validation.definitionInvalid")),
    );
  }
  return issues;
}

/**
 * The plain label for a validation field (`name`, `pattern.size`,
 * `scatters.0.minSize`, `focus.animation.minVisibleMs`), as the Checks list
 * and messages name it.
 */
export function sceneEffectFieldLabel(field: string): string {
  const t = getI18n().getFixedT(null, "effects");
  const scatter = /^scatters\.(\d+)\.(.+)$/.exec(field);
  if (scatter)
    return sceneScatterFieldLabel(Number(scatter[1]) + 1, scatter[2]!);
  const indexed = /^(marquee\.items|gradient\.stops)\.(\d+)$/.exec(field);
  if (indexed)
    return indexed[1] === "marquee.items"
      ? t("scene.fields.marqueeItem", { index: Number(indexed[2]) + 1 })
      : t("scene.fields.gradientStop", { index: Number(indexed[2]) + 1 });
  switch (field) {
    case "name":
      return t("scene.fields.name");
    case "description":
      return t("scene.fields.description");
    case "duration":
      return t("scene.fields.duration");
    case "sound":
      return t("scene.fields.sound");
    case "images":
      return t("scene.fields.images");
    case "solid.color":
      return t("scene.fields.solidColor");
    case "pattern.color":
      return t("scene.fields.patternColor");
    case "pattern.size":
      return t("scene.fields.patternSize");
    case "pattern.spacing":
      return t("scene.fields.patternSpacing");
    case "pattern.opacity":
      return t("scene.fields.patternOpacity");
    case "marquee.items":
      return t("scene.fields.marqueeItems");
    case "marquee.itemSize":
      return t("scene.fields.itemSize");
    case "marquee.gap":
      return t("scene.fields.gap");
    case "marquee.rowGap":
      return t("scene.fields.rowGap");
    case "marquee.rotation":
      return t("scene.fields.rotationOffset");
    case "marquee.speed":
      return t("scene.fields.speed");
    case "marquee.opacity":
      return t("scene.fields.marqueeOpacity");
    case "focus.color":
      return t("scene.fields.lineColor");
    case "focus.lineCount":
      return t("scene.fields.lineCount");
    case "focus.opacity":
      return t("scene.fields.lineOpacity");
    case "focus.baseThickness":
      return t("scene.fields.baseThickness");
    case "focus.thicknessVariation":
      return t("scene.fields.thicknessVariation");
    case "focus.lengthVariation":
      return t("scene.fields.lengthVariation");
    case "focus.overscan":
      return t("scene.fields.overscan");
    case "focus.paddingX":
      return t("scene.fields.paddingX");
    case "focus.paddingY":
      return t("scene.fields.paddingY");
    case "focus.target":
      return t("scene.fields.target");
    case "focus.animation":
      return t("scene.fields.flicker");
    case "focus.animation.minVisibleMs":
      return t("scene.fields.minVisibleMs");
    case "focus.animation.maxVisibleMs":
      return t("scene.fields.maxVisibleMs");
    case "focus.animation.minHiddenMs":
      return t("scene.fields.minHiddenMs");
    case "focus.animation.maxHiddenMs":
      return t("scene.fields.maxHiddenMs");
    case "focus.animation.opacityJitter":
      return t("scene.fields.opacityJitter");
    case "focus.seed":
      return t("scene.fields.seed");
    case "gradient.angle":
      return t("scene.fields.gradientAngle");
    case "gradient.centerX":
      return t("scene.fields.gradientCenterX");
    case "gradient.centerY":
      return t("scene.fields.gradientCenterY");
    case "gradient.stops":
      return t("scene.fields.gradientStops");
    case "tile.image":
      return t("scene.fields.tileImage");
    case "tile.size":
      return t("scene.fields.tileSize");
    case "tile.opacity":
      return t("scene.fields.tileOpacity");
    case "tile.speed":
      return t("scene.fields.tileSpeed");
    case "screen.color":
      return t("scene.fields.screenColor");
    case "screen.count":
      return t("scene.fields.screenCount");
    case "screen.opacity":
      return t("scene.fields.screenOpacity");
    case "screen.centerX":
      return t("scene.fields.screenCenterX");
    case "screen.centerY":
      return t("scene.fields.screenCenterY");
    case "screen.throb":
      return t("scene.fields.screenThrob");
    case "screen.seed":
      return t("scene.fields.screenSeed");
    case "screen.turnSeconds":
      return t("scene.fields.screenTurn");
    case "screen.minLength":
      return t("scene.fields.screenMinLength");
    case "screen.maxLength":
      return t("scene.fields.screenMaxLength");
    case "screen.length":
      return t("scene.fields.screenLength");
    case "screen.minWidth":
      return t("scene.fields.screenMinWidth");
    case "screen.maxWidth":
      return t("scene.fields.screenMaxWidth");
    case "screen.width":
      return t("scene.fields.screenWidth");
    case "screen.sway":
      return t("scene.fields.screenSway");
    case "scatters":
      return t("scene.fields.scatters");
    case "flash.color":
      return t("scene.fields.flashColor");
    case "flash.duration":
      return t("scene.fields.flashDuration");
    default:
      return t("scene.fields.definition");
  }
}

/** A scatter layer's field (`minSize`, `items.2`), for scatter layer `layer` (1-based). */
function sceneScatterFieldLabel(layer: number, field: string): string {
  const t = getI18n().getFixedT(null, "effects");
  const item = /^items\.(\d+)$/.exec(field);
  if (item)
    return t("scene.fields.scatter.item", {
      layer,
      index: Number(item[1]) + 1,
    });
  switch (field) {
    case "items":
      return t("scene.fields.scatter.items", { layer });
    case "count":
      return t("scene.fields.scatter.count", { layer });
    case "seed":
      return t("scene.fields.scatter.seed", { layer });
    case "minSize":
      return t("scene.fields.scatter.minSize", { layer });
    case "maxSize":
      return t("scene.fields.scatter.maxSize", { layer });
    case "size":
      return t("scene.fields.scatter.size", { layer });
    case "minRotationDeg":
      return t("scene.fields.scatter.minRotation", { layer });
    case "maxRotationDeg":
      return t("scene.fields.scatter.maxRotation", { layer });
    case "rotation":
      return t("scene.fields.scatter.rotation", { layer });
    case "minOpacity":
      return t("scene.fields.scatter.minOpacity", { layer });
    case "maxOpacity":
      return t("scene.fields.scatter.maxOpacity", { layer });
    case "opacity":
      return t("scene.fields.scatter.opacity", { layer });
    case "regionTop":
      return t("scene.fields.scatter.regionTop", { layer });
    case "regionBottom":
      return t("scene.fields.scatter.regionBottom", { layer });
    case "region":
      return t("scene.fields.scatter.region", { layer });
    case "minSpinDegPerSec":
      return t("scene.fields.scatter.minSpin", { layer });
    case "maxSpinDegPerSec":
      return t("scene.fields.scatter.maxSpin", { layer });
    case "spin":
      return t("scene.fields.scatter.spin", { layer });
    case "speed":
      return t("scene.fields.scatter.speed", { layer });
    default:
      return t("scene.fields.scatter.layer", { layer });
  }
}

function validateBackground(
  document: SceneEffectEditorDocument,
  resources: readonly SceneEffectEditorImageResource[],
  issues: SceneEffectValidationIssue[],
) {
  const t = getI18n().getFixedT(null, "effects");
  const { solid, pattern, marquee, gradient, tile, screen, scatters, flash } =
    document.background;
  const color = (field: string, value: string, message: string) => {
    if (!COLOR_PATTERN.test(value)) issue(issues, field, message);
  };
  color("solid.color", solid.color, t("scene.validation.solidColor"));
  color("pattern.color", pattern.color, t("scene.validation.patternColor"));
  gradient.stops.forEach((stop, index) =>
    color(
      `gradient.stops.${index}`,
      stop.color,
      t("scene.validation.gradientStopColor"),
    ),
  );
  color("screen.color", screen.color, t("scene.validation.screenColor"));
  color("flash.color", flash.color, t("scene.validation.flashColor"));
  for (const [field, items] of [
    ["marquee.items", marquee.items],
    ...scatters.map(
      (layer, index) => [`scatters.${index}.items`, layer.items] as const,
    ),
  ] as const)
    if (new Set(items.map((item) => item.id)).size !== items.length)
      issue(issues, field, t("scene.validation.duplicateItemIds"));
  if (tile.enabled && !tile.image)
    issue(issues, "tile.image", t("scene.validation.tileImage"));
  const metadata = sceneEffectImageMetadata(document);
  if (metadata.length > SCENE_IMAGE_LIMITS.count)
    issue(
      issues,
      "images",
      t("scene.validation.tooManyImages", { max: SCENE_IMAGE_LIMITS.count }),
    );
  const resourcesByName = new Map(
    resources.map((resource) => [resource.logicalName, resource]),
  );
  for (const image of metadata) {
    if (!SCENE_EFFECT_IMAGE_TYPES.has(image.contentType))
      issue(
        issues,
        "images",
        t("scene.validation.imageType", { file: image.originalName }),
      );
    if (!resourcesByName.has(image.logicalName))
      issue(
        issues,
        "images",
        t("scene.validation.reselectImage", { file: image.originalName }),
      );
  }
  const totalBytes = metadata.reduce((sum, image) => sum + image.sizeBytes, 0);
  if (totalBytes > SCENE_IMAGE_LIMITS.totalBytes)
    issue(
      issues,
      "images",
      t("scene.validation.imagesTooLarge", {
        size: formattersForLanguage(getI18n().resolvedLanguage).fileSize(
          SCENE_IMAGE_LIMITS.totalBytes,
        ),
      }),
    );
}

function validateFocus(
  document: SceneEffectEditorDocument,
  issues: SceneEffectValidationIssue[],
) {
  const t = getI18n().getFixedT(null, "effects");
  const focus = document.focus;
  if (!COLOR_PATTERN.test(focus.color))
    issue(issues, "focus.color", t("scene.validation.lineColor"));
  if (focus.target.kind === "manual_box") {
    const { x, y, width, height } = focus.target.rect;
    if (
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1 ||
      y + height > 1
    )
      issue(issues, "focus.target", t("scene.validation.manualTarget"));
  }
  const animation = focus.animation;
  if (
    animation.minVisibleMs > animation.maxVisibleMs ||
    animation.minHiddenMs > animation.maxHiddenMs
  )
    issue(issues, "focus.animation", t("scene.validation.flickerOrder"));
}

export function sceneEffectDocumentFingerprint(
  document: SceneEffectEditorDocument,
): string {
  return JSON.stringify(canonicalJson(document));
}

export function buildSceneEffectEditorExport(
  document: SceneEffectEditorDocument,
): SceneEffectEditorExport {
  return {
    schema: SCENE_EFFECT_EDITOR_SCHEMA,
    document: cloneSceneEffectDocument(document),
  };
}

export function parseSceneEffectEditorExport(
  value: unknown,
): SceneEffectEditorDocument {
  const record = object(value);
  const raw = object(record?.document);
  const t = getI18n().getFixedT(null, "effects");
  if (record?.schema !== SCENE_EFFECT_EDITOR_SCHEMA || !raw)
    throw new WordedError(t("scene.import.notDocument"));
  const document = raw as unknown as SceneEffectEditorDocument;
  if (document.schema !== SCENE_EFFECT_EDITOR_SCHEMA)
    throw new WordedError(t("scene.import.unsupportedSchema"));
  const clone = normalizeSceneEffectDocument(
    cloneSceneEffectDocument(document),
  );
  const images = sceneEffectImageMetadata(clone);
  sceneEffectRuntimeEntry(
    clone,
    new Map(
      images.map((image) => [
        image.logicalName,
        `blob:import-${image.logicalName}`,
      ]),
    ),
  );
  return clone;
}

export function createSceneEffectDocumentFromDefinition(args: {
  name: string;
  description: string;
  definition: unknown;
  images: ReadonlyMap<string, SceneEffectEditorImage>;
  sound: SceneEffectEditorSound | null;
}): SceneEffectEditorDocument {
  const t = getI18n().getFixedT(null, "effects");
  const raw = object(args.definition);
  if (!raw) throw new WordedError(t("scene.open.definitionUnavailable"));
  const defaults = createDefaultSceneEffectDocument();
  const kind = raw.kind;
  if (kind !== "background_layers" && kind !== "focus_lines")
    throw new WordedError(t("scene.open.kindUnsupported"));
  const durationMs =
    raw.durationMs === null
      ? null
      : Number(raw.durationMs ?? defaults.durationMs);
  const document: SceneEffectEditorDocument = {
    ...defaults,
    name: args.name,
    description: args.description,
    kind,
    durationMs,
    coverUiOverlays: Boolean(raw.coverUiOverlays),
    dismissOnInput:
      raw.dismissOnInput === undefined
        ? kind === "background_layers"
        : Boolean(raw.dismissOnInput),
    sound: args.sound,
  };
  if (kind === "background_layers") {
    const solid = object(raw.solid);
    const pattern = object(raw.pattern);
    const marquee = object(raw.marquee);
    if (!solid || !pattern || !marquee || !Array.isArray(marquee.items))
      throw new WordedError(t("scene.open.backgroundIncomplete"));
    const items = marquee.items.map((value, index) =>
      hydrateMarqueeItem(value, index, args.images),
    );
    type Background = SceneEffectEditorDocument["background"];
    const optional = defaultSceneOptionalLayers();
    const tile = object(raw.tile);
    const tileImage =
      tile && typeof tile.image === "string"
        ? args.images.get(tile.image)
        : null;
    if (tile && !tileImage)
      throw new WordedError(
        t("scene.open.imageUnavailable", { file: String(tile.image) }),
      );
    document.background = {
      solid: solid as unknown as Background["solid"],
      pattern: pattern as unknown as Background["pattern"],
      marquee: {
        ...(marquee as unknown as Omit<Background["marquee"], "items">),
        items,
      },
      // The optional layers (C1–C6); an absent one is off.
      gradient:
        (object(raw.gradient) as unknown as Background["gradient"] | null) ??
        optional.gradient,
      tile:
        tile && tileImage
          ? {
              ...(tile as unknown as Omit<Background["tile"], "image">),
              image: tileImage,
            }
          : optional.tile,
      screen:
        (object(raw.screen) as unknown as Background["screen"] | null) ??
        optional.screen,
      scatters: Array.isArray(raw.scatters)
        ? raw.scatters.map((value, index) => {
            const layer = object(value);
            if (!layer || !Array.isArray(layer.items))
              throw new WordedError(
                t("scene.open.scatterInvalid", { index: index + 1 }),
              );
            return {
              ...(layer as unknown as Background["scatters"][number]),
              items: layer.items.map((item, itemIndex) =>
                hydrateMarqueeItem(item, itemIndex, args.images),
              ),
            };
          })
        : optional.scatters,
      flash:
        (object(raw.flash) as unknown as Background["flash"] | null) ??
        optional.flash,
    };
  } else {
    const target = object(raw.target);
    const animation = object(raw.animation);
    if (!target || !animation)
      throw new WordedError(t("scene.open.focusIncomplete"));
    document.focus = {
      renderPlacement:
        raw.renderPlacement as SceneEffectEditorDocument["focus"]["renderPlacement"],
      lineCount: Number(raw.lineCount),
      color: String(raw.color),
      opacity: Number(raw.opacity),
      baseThicknessPx: Number(raw.baseThicknessPx),
      thicknessVariationPx: Number(raw.thicknessVariationPx),
      lengthVariation: Number(raw.lengthVariation),
      overscanPx: Number(raw.overscanPx),
      target: target as unknown as SceneEffectEditorDocument["focus"]["target"],
      animation:
        animation as unknown as SceneEffectEditorDocument["focus"]["animation"],
      seed:
        raw.seed === null || raw.seed === undefined ? null : Number(raw.seed),
    };
  }
  sceneEffectRuntimeEntry(
    document,
    new Map([...args.images].map(([name]) => [name, `blob:hydrate-${name}`])),
  );
  return document;
}

function hydrateMarqueeItem(
  value: unknown,
  index: number,
  images: ReadonlyMap<string, SceneEffectEditorImage>,
): SceneEffectEditorMarqueeItem {
  const t = getI18n().getFixedT(null, "effects");
  const item = object(value);
  if (!item)
    throw new WordedError(t("scene.open.itemInvalid", { index: index + 1 }));
  if (item.kind === "image") {
    const logicalName = String(item.image ?? "");
    const image = images.get(logicalName);
    if (!image)
      throw new WordedError(
        logicalName
          ? t("scene.open.imageUnavailable", { file: logicalName })
          : t("scene.open.itemImageUnavailable", { index: index + 1 }),
      );
    return {
      id: String(item.id),
      kind: "image",
      label: String(item.label),
      image,
    };
  }
  if (item.kind !== "emoji")
    throw new WordedError(
      t("scene.open.itemUnsupported", { index: index + 1 }),
    );
  // A Twemoji item, kept so the creator can show it as missing.
  return {
    id: String(item.id),
    kind: "emoji",
    label: String(item.label),
    emoji: String(item.emoji),
  };
}

function definitionItem(
  item: SceneEffectEditorMarqueeItem,
): Record<string, unknown> {
  if (item.kind === "image")
    return {
      id: item.id,
      kind: "image",
      label: item.label,
      image: item.image.logicalName,
    };
  // A legacy Twemoji item stays in the definition (the runtime skips it) and
  // blocks Save until it is replaced; any other kind is a forged document.
  if (item.kind === "emoji")
    return { id: item.id, kind: "emoji", label: item.label, emoji: item.emoji };
  const t = getI18n().getFixedT(null, "effects");
  throw new WordedError(t("scene.open.itemKindUnsupported"));
}

function issue(
  issues: SceneEffectValidationIssue[],
  field: string,
  message: string,
) {
  issues.push({ field, severity: "error", message });
}

function boundsMessage(
  setting: string,
  min: number,
  max: number,
  integer: boolean,
): string {
  const t = getI18n().getFixedT(null, "effects");
  return integer
    ? t("scene.validation.boundsWhole", { setting, min, max })
    : t("scene.validation.bounds", { setting, min, max });
}

/** A definition limit issue (`sceneDefinitionLimitIssues`) in the UI Locale. */
function sceneLimitMessage({ field, problem }: SceneLimitIssue): string {
  const t = getI18n().getFixedT(null, "effects");
  const setting = sceneEffectFieldLabel(field);
  switch (problem.kind) {
    case "range":
      return boundsMessage(
        setting,
        problem.minimum,
        problem.maximum,
        problem.integer,
      );
    case "order":
      return t("scene.validation.minAboveMax", { setting });
    case "ascending":
      return t("scene.validation.stopsAscending");
    case "count":
      return problem.minimum > 0
        ? t("scene.validation.countRange", {
            setting,
            min: problem.minimum,
            max: problem.maximum,
          })
        : t("scene.validation.countAtMost", { setting, max: problem.maximum });
    case "total":
      return t("scene.validation.scatterTotal", { max: problem.maximum });
    case "legacyEmoji":
      // The label is the stored item name, shown as it was saved.
      return problem.label
        ? t("scene.validation.legacyEmoji", { label: problem.label })
        : t("scene.validation.legacyEmojiUnnamed");
  }
}

function isExactContentSource(value: unknown): value is PyExactContentSource {
  const source = object(value);
  return source?.type === "catalog"
    ? typeof source.catalog_item_id === "string" &&
        source.catalog_item_id.length > 0
    : source?.type === "builtin" &&
        typeof source.content_id === "string" &&
        source.content_id.length > 0 &&
        Number.isInteger(source.version) &&
        Number(source.version) > 0;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  return value;
}

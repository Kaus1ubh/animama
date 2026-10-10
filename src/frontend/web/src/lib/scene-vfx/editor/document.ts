import { getI18n } from "react-i18next";

import type {
  PyContentDependency,
  PyExactContentSource,
} from "@/lib/content/catalogTypes";
import { failureLine, WordedError } from "@/lib/errors/apiError";
import { parseSceneVFXEntry } from "@/lib/scene-vfx/catalog";
import type { SceneVFXEntry } from "@/lib/scene-vfx/types";
import {
  createDefaultSceneEffectDocument,
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
const MAX_SCENE_IMAGE_COUNT = 16;
const MAX_SCENE_IMAGE_BYTES = 32 * 1024 * 1024;

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

export function canonicalSceneEffectImageName(filename: string): string {
  const basename =
    filename.replaceAll("\\", "/").split("/").at(-1) ?? "scene-item";
  const stem =
    basename
      .replace(/\.[^.]+$/, "")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "scene-item";
  return `${stem}${/\.svg$/i.test(basename) ? ".svg" : ".webp"}`;
}

export function uniqueSceneEffectImageName(
  filename: string,
  existingNames: Iterable<string>,
): string {
  const canonical = canonicalSceneEffectImageName(filename);
  const existing = new Set(existingNames);
  if (!existing.has(canonical)) return canonical;
  const extension = canonical.match(/\.[^.]+$/)?.[0] ?? ".webp";
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
    return {
      ...common,
      solid: { ...document.background.solid },
      pattern: { ...document.background.pattern },
      marquee: {
        ...document.background.marquee,
        items: document.background.marquee.items.map(definitionItem),
      },
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

export function sceneEffectRuntimeEntry(
  document: SceneEffectEditorDocument,
  imageUrls: ReadonlyMap<string, string>,
): SceneVFXEntry {
  const definition = sceneEffectDefinition(document);
  const projected = structuredClone(definition);
  if (document.kind === "background_layers") {
    const marquee = object(projected.marquee);
    if (!marquee) throw new Error("The marquee definition is unavailable.");
    marquee.items = document.background.marquee.items.map((item) => {
      if (item.kind === "emoji") return { ...item };
      const src = imageUrls.get(item.image.logicalName);
      if (!src) {
        const t = getI18n().getFixedT(null, "effects");
        throw new WordedError(
          t("scene.validation.reselectForPreview", {
            file: item.image.originalName,
          }),
        );
      }
      return { id: item.id, kind: "png", label: item.label, src };
    });
  }
  return parseSceneVFXEntry({
    ...projected,
    id: "scene-effect-editor-preview",
    label: document.name || "Scene Effect preview",
    enabled: true,
    ...(document.sound ? { sound: { onApply: document.sound.alias } } : {}),
  });
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

export function sceneEffectImageMetadata(
  document: SceneEffectEditorDocument,
): SceneEffectEditorImage[] {
  if (document.kind !== "background_layers") return [];
  const byName = new Map<string, SceneEffectEditorImage>();
  for (const item of document.background.marquee.items) {
    if (item.kind === "image") byName.set(item.image.logicalName, item.image);
  }
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
 * `focus.animation.minVisibleMs`), as the Checks list and messages name it.
 */
export function sceneEffectFieldLabel(field: string): string {
  const t = getI18n().getFixedT(null, "effects");
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
    default:
      return t("scene.fields.definition");
  }
}

function validateBackground(
  document: SceneEffectEditorDocument,
  resources: readonly SceneEffectEditorImageResource[],
  issues: SceneEffectValidationIssue[],
) {
  const t = getI18n().getFixedT(null, "effects");
  const { solid, pattern, marquee } = document.background;
  if (!COLOR_PATTERN.test(solid.color))
    issue(issues, "solid.color", t("scene.validation.solidColor"));
  if (!COLOR_PATTERN.test(pattern.color))
    issue(issues, "pattern.color", t("scene.validation.patternColor"));
  bounded(issues, "pattern.size", pattern.size, 1, 512);
  bounded(issues, "pattern.spacing", pattern.spacing, 0, 1024);
  bounded(issues, "pattern.opacity", pattern.opacity, 0, 1);
  if (marquee.items.length > 64)
    issue(
      issues,
      "marquee.items",
      t("scene.validation.tooManyItems", { max: 64 }),
    );
  if (
    new Set(marquee.items.map((item) => item.id)).size !== marquee.items.length
  )
    issue(issues, "marquee.items", t("scene.validation.duplicateItemIds"));
  bounded(issues, "marquee.itemSize", marquee.itemSize, 1, 1024);
  bounded(issues, "marquee.gap", marquee.gap, 0, 2048);
  bounded(issues, "marquee.rowGap", marquee.rowGap, 0, 2048);
  bounded(issues, "marquee.rotation", marquee.itemRotationOffsetDeg, -360, 360);
  bounded(issues, "marquee.speed", marquee.speedPxPerSec, 0, 2000);
  bounded(issues, "marquee.opacity", marquee.opacity, 0, 1);
  const metadata = sceneEffectImageMetadata(document);
  if (metadata.length > MAX_SCENE_IMAGE_COUNT)
    issue(
      issues,
      "images",
      t("scene.validation.tooManyImages", { max: MAX_SCENE_IMAGE_COUNT }),
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
  if (totalBytes > MAX_SCENE_IMAGE_BYTES)
    issue(issues, "images", sceneImagesTooLargeMessage());
}

/** The private image budget, shared by validation and the image chooser. */
export function sceneImagesTooLargeMessage(): string {
  const t = getI18n().getFixedT(null, "effects");
  return t("scene.validation.imagesTooLarge", {
    size: formattersForLanguage(getI18n().resolvedLanguage).fileSize(
      MAX_SCENE_IMAGE_BYTES,
    ),
  });
}

function validateFocus(
  document: SceneEffectEditorDocument,
  issues: SceneEffectValidationIssue[],
) {
  const t = getI18n().getFixedT(null, "effects");
  const focus = document.focus;
  if (!COLOR_PATTERN.test(focus.color))
    issue(issues, "focus.color", t("scene.validation.lineColor"));
  bounded(issues, "focus.lineCount", focus.lineCount, 1, 256, true);
  bounded(issues, "focus.opacity", focus.opacity, 0, 1);
  bounded(issues, "focus.baseThickness", focus.baseThicknessPx, 0.1, 128);
  bounded(
    issues,
    "focus.thicknessVariation",
    focus.thicknessVariationPx,
    0,
    128,
  );
  bounded(issues, "focus.lengthVariation", focus.lengthVariation, 0, 1);
  bounded(issues, "focus.overscan", focus.overscanPx, 0, 4096);
  if (focus.target.kind === "avatar_face") {
    bounded(issues, "focus.paddingX", focus.target.paddingXPx, 0, 2048);
    bounded(issues, "focus.paddingY", focus.target.paddingYPx, 0, 2048);
  } else {
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
  for (const [field, value] of Object.entries(animation))
    bounded(
      issues,
      `focus.animation.${field}`,
      value,
      0,
      field === "opacityJitter" ? 1 : 10_000,
    );
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
  const clone = cloneSceneEffectDocument(document);
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
    document.background = {
      solid:
        solid as unknown as SceneEffectEditorDocument["background"]["solid"],
      pattern:
        pattern as unknown as SceneEffectEditorDocument["background"]["pattern"],
      marquee: {
        ...(marquee as unknown as Omit<
          SceneEffectEditorDocument["background"]["marquee"],
          "items"
        >),
        items,
      },
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
  return {
    id: String(item.id),
    kind: "emoji",
    label: String(item.label),
    emoji: String(item.emoji),
    provider: "twemoji",
  };
}

function definitionItem(
  item: SceneEffectEditorMarqueeItem,
): Record<string, unknown> {
  return item.kind === "image"
    ? {
        id: item.id,
        kind: "image",
        label: item.label,
        image: item.image.logicalName,
      }
    : {
        id: item.id,
        kind: "emoji",
        label: item.label,
        emoji: item.emoji,
        provider: "twemoji",
      };
}

function issue(
  issues: SceneEffectValidationIssue[],
  field: string,
  message: string,
) {
  issues.push({ field, severity: "error", message });
}

function bounded(
  issues: SceneEffectValidationIssue[],
  field: string,
  value: number,
  minimum: number,
  maximum: number,
  integer = false,
) {
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  )
    issue(
      issues,
      field,
      boundsMessage(sceneEffectFieldLabel(field), minimum, maximum, integer),
    );
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

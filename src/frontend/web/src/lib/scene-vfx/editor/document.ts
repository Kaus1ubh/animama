import type {
  PyContentDependency,
  PyExactContentSource,
} from "@/lib/content/catalogTypes";
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

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
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
  return `${stem}.webp`;
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
      if (!src)
        throw new Error(`Reselect ${item.image.originalName} for preview.`);
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
  const issues: SceneEffectValidationIssue[] = [];
  if (!document.name.trim() || document.name.trim().length > 120)
    issue(
      issues,
      "name",
      "Give the Scene Effect a name between 1 and 120 characters.",
    );
  if (document.description.length > 2000)
    issue(
      issues,
      "description",
      "Description must be 2,000 characters or shorter.",
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
      "Duration must be sticky or between 0.1 and 30 seconds.",
    );
  if (document.sound && !isExactContentSource(document.sound.source))
    issue(
      issues,
      "sound",
      "Reselect the Sound Effect so exact catalog content can be saved.",
    );

  if (document.kind === "background_layers") {
    validateBackground(document, resources, issues);
  } else {
    validateFocus(document, issues);
    if (resources.length > 0)
      issues.push({
        field: "images",
        severity: "warning",
        message:
          "Unused background image bytes will not be saved with Focus Lines.",
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
      error instanceof Error
        ? error.message
        : "The Scene Effect definition is invalid.",
    );
  }
  return issues;
}

function validateBackground(
  document: SceneEffectEditorDocument,
  resources: readonly SceneEffectEditorImageResource[],
  issues: SceneEffectValidationIssue[],
) {
  const { solid, pattern, marquee } = document.background;
  if (!COLOR_PATTERN.test(solid.color))
    issue(issues, "solid.color", "Choose a six-digit hex solid color.");
  if (!COLOR_PATTERN.test(pattern.color))
    issue(issues, "pattern.color", "Choose a six-digit hex pattern color.");
  bounded(issues, "pattern.size", pattern.size, 1, 512);
  bounded(issues, "pattern.spacing", pattern.spacing, 0, 1024);
  bounded(issues, "pattern.opacity", pattern.opacity, 0, 1);
  if (marquee.items.length > 64)
    issue(issues, "marquee.items", "A marquee can contain at most 64 items.");
  if (
    new Set(marquee.items.map((item) => item.id)).size !== marquee.items.length
  )
    issue(issues, "marquee.items", "Every marquee item needs a unique id.");
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
      "A Scene Effect can contain at most 16 private images.",
    );
  const resourcesByName = new Map(
    resources.map((resource) => [resource.logicalName, resource]),
  );
  for (const image of metadata) {
    if (!IMAGE_TYPES.has(image.contentType))
      issue(
        issues,
        "images",
        `${image.originalName} is not PNG, JPEG, or WebP.`,
      );
    if (!resourcesByName.has(image.logicalName))
      issue(
        issues,
        "images",
        `Reselect ${image.originalName} so its bytes can be saved.`,
      );
  }
  const totalBytes = metadata.reduce((sum, image) => sum + image.sizeBytes, 0);
  if (totalBytes > MAX_SCENE_IMAGE_BYTES)
    issue(issues, "images", "Private Scene images must total 32 MiB or less.");
}

function validateFocus(
  document: SceneEffectEditorDocument,
  issues: SceneEffectValidationIssue[],
) {
  const focus = document.focus;
  if (!COLOR_PATTERN.test(focus.color))
    issue(issues, "focus.color", "Choose a six-digit hex line color.");
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
      issue(
        issues,
        "focus.target",
        "The manual target must stay within the normalized viewport.",
      );
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
    issue(
      issues,
      "focus.animation",
      "Minimum flicker times cannot exceed their maximums.",
    );
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
  if (record?.schema !== SCENE_EFFECT_EDITOR_SCHEMA || !raw)
    throw new Error("This is not an Animama Scene Effect editor document.");
  const document = raw as unknown as SceneEffectEditorDocument;
  if (document.schema !== SCENE_EFFECT_EDITOR_SCHEMA)
    throw new Error("The Scene Effect editor schema is unsupported.");
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
  const raw = object(args.definition);
  if (!raw) throw new Error("The Scene Effect definition is unavailable.");
  const defaults = createDefaultSceneEffectDocument();
  const kind = raw.kind;
  if (kind !== "background_layers" && kind !== "focus_lines")
    throw new Error("The Scene Effect kind is unsupported.");
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
      throw new Error("The background layer definition is incomplete.");
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
      throw new Error("The focus-line definition is incomplete.");
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
  const item = object(value);
  if (!item) throw new Error(`Marquee item ${index + 1} is invalid.`);
  if (item.kind === "image") {
    const logicalName = String(item.image ?? "");
    const image = images.get(logicalName);
    if (!image)
      throw new Error(
        `The release image ${logicalName || index + 1} is unavailable.`,
      );
    return {
      id: String(item.id),
      kind: "image",
      label: String(item.label),
      image,
    };
  }
  if (item.kind !== "emoji")
    throw new Error(`Marquee item ${index + 1} is unsupported.`);
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
      `${field} must be between ${minimum} and ${maximum}${integer ? " in whole steps" : ""}.`,
    );
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

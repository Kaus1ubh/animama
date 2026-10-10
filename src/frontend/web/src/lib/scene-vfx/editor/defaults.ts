import {
  getSceneFocusLinesVFXPresetById,
  getSceneVFXPresetById,
} from "@/lib/scene-vfx/presets";
import type { SceneBackgroundLineItem } from "@/lib/scene-vfx/types";
import type {
  SceneEffectEditorBackground,
  SceneEffectEditorDocument,
  SceneEffectEditorMarqueeItem,
  SceneEffectEditorFocus,
  SceneEffectTemplateId,
} from "./types";
import { SCENE_EFFECT_EDITOR_SCHEMA } from "./types";

/** Default Anima-theme background used by the live chat canvas. */
export const DEFAULT_SCENE_SOLID_COLOR = "#faf9f5";

/** Default Anima-theme primary blue used by the Scene pattern layer. */
export const DEFAULT_SCENE_PATTERN_COLOR = "#87ceeb";

/**
 * The starting templates. Their labels are names, like Included content
 * names: they stay as written in every UI Locale, and a draft started from a
 * template is named after it.
 */
export const SCENE_EFFECT_TEMPLATE_OPTIONS: Array<{
  id: SceneEffectTemplateId;
  label: string;
  kind: "background_layers" | "focus_lines";
}> = [
  {
    id: "kawaii-sparkles",
    label: "Kawaii Sparkles",
    kind: "background_layers",
  },
  {
    id: "shoujo-hearts",
    label: "Shoujo Hearts",
    kind: "background_layers",
  },
  { id: "comic-pop", label: "Comic Pop", kind: "background_layers" },
  { id: "dark", label: "Dark Focus", kind: "focus_lines" },
  { id: "light-streak", label: "Light Streak", kind: "focus_lines" },
];

/** The display label of a starting template, for example "Dark Focus". */
export function sceneEffectTemplateLabel(
  templateId: SceneEffectTemplateId,
): string {
  return (
    SCENE_EFFECT_TEMPLATE_OPTIONS.find((option) => option.id === templateId)
      ?.label ?? templateId
  );
}

/** Clone a code-shipped preset into a private, independently editable draft. */
export function sceneEffectTemplate(
  templateId: SceneEffectTemplateId,
): Pick<SceneEffectEditorDocument, "kind" | "background" | "focus"> {
  const background = defaultBackground(templateId);
  const focus = defaultFocus(templateId);
  return {
    kind:
      templateId === "dark" || templateId === "light-streak"
        ? "focus_lines"
        : "background_layers",
    background,
    focus,
  };
}

export function createDefaultSceneEffectDocument(): SceneEffectEditorDocument {
  return {
    schema: SCENE_EFFECT_EDITOR_SCHEMA,
    name: "",
    description: "",
    kind: "background_layers",
    durationMs: 5000,
    coverUiOverlays: false,
    dismissOnInput: true,
    sound: null,
    background: emptyBackground(),
    focus: defaultFocus("dark"),
  };
}

/** Start new documents with the three independently editable layers enabled. */
function emptyBackground(): SceneEffectEditorBackground {
  return {
    solid: { enabled: true, color: DEFAULT_SCENE_SOLID_COLOR },
    pattern: {
      enabled: true,
      pattern: "polkadot",
      color: DEFAULT_SCENE_PATTERN_COLOR,
      size: 32,
      spacing: 32,
      opacity: 0.35,
    },
    marquee: {
      enabled: true,
      items: [],
      itemSize: 96,
      gap: 40,
      rowGap: 64,
      direction: "static",
      itemRotationMode: "upright",
      itemRotationOffsetDeg: 0,
      speedPxPerSec: 0,
      opacity: 1,
    },
  };
}

function defaultBackground(
  templateId: SceneEffectTemplateId,
): SceneEffectEditorBackground {
  const fallback = getSceneVFXPresetById("kawaii-sparkles");
  const selected =
    templateId === "dark" || templateId === "light-streak"
      ? fallback
      : getSceneVFXPresetById(templateId);
  const entry =
    selected?.kind === "background_layers"
      ? selected
      : fallback?.kind === "background_layers"
        ? fallback
        : null;
  if (!entry) throw new Error("The default Scene background is unavailable.");
  return {
    solid: { ...entry.solid },
    pattern: { ...entry.pattern },
    marquee: {
      ...entry.marquee,
      items: entry.marquee.items.flatMap(toPortableItem),
    },
  };
}

function defaultFocus(
  templateId: SceneEffectTemplateId,
): SceneEffectEditorFocus {
  const id =
    templateId === "dark" || templateId === "light-streak"
      ? templateId
      : "dark";
  const entry = getSceneFocusLinesVFXPresetById(id);
  return {
    renderPlacement: entry.renderPlacement,
    lineCount: entry.lineCount,
    color: entry.color,
    opacity: entry.opacity,
    baseThicknessPx: entry.baseThicknessPx,
    thicknessVariationPx: entry.thicknessVariationPx,
    lengthVariation: entry.lengthVariation,
    overscanPx: entry.overscanPx,
    target: structuredClone(entry.target),
    animation: { ...entry.animation },
    seed: entry.seed ?? null,
  };
}

function toPortableItem(
  item: SceneBackgroundLineItem,
): SceneEffectEditorMarqueeItem[] {
  if (item.kind !== "emoji") return [];
  return [
    {
      id: item.id,
      kind: "emoji",
      label: item.label,
      emoji: item.emoji,
      provider: "twemoji",
    },
  ];
}

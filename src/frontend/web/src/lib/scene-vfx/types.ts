export const SCENE_VFX_KINDS = ["background_layers", "focus_lines"] as const;
export type SceneVFXKind = (typeof SCENE_VFX_KINDS)[number];

export type SceneVFXRenderBand = "underlay" | "overlay";

export const SCENE_BACKGROUND_PATTERN_KINDS = [
  "none",
  "polkadot",
  "heart",
  "star",
] as const;
export type SceneBackgroundPatternKind =
  (typeof SCENE_BACKGROUND_PATTERN_KINDS)[number];

export const SCENE_BACKGROUND_DIRECTIONS = [
  "static",
  "left",
  "right",
  "up",
  "down",
  "diagonal-up-left",
  "diagonal-down-left",
  "diagonal-up-right",
  "diagonal-down-right",
] as const;
export type SceneBackgroundDirection =
  (typeof SCENE_BACKGROUND_DIRECTIONS)[number];

export const SCENE_BACKGROUND_ITEM_ROTATION_MODES = [
  "upright",
  "follow-track",
] as const;
export type SceneBackgroundItemRotationMode =
  (typeof SCENE_BACKGROUND_ITEM_ROTATION_MODES)[number];

export const SCENE_BACKGROUND_EMOJI_PROVIDERS = ["twemoji"] as const;
export type SceneBackgroundEmojiProvider =
  (typeof SCENE_BACKGROUND_EMOJI_PROVIDERS)[number];

export const SCENE_FOCUS_LINES_RENDER_PLACEMENTS = [
  "behind_avatar",
  "front_of_avatar",
] as const;
export type SceneFocusLinesRenderPlacement =
  (typeof SCENE_FOCUS_LINES_RENDER_PLACEMENTS)[number];

export const SCENE_FOCUS_LINES_TARGET_KINDS = [
  "avatar_face",
  "manual_box",
] as const;
export type SceneFocusLinesTargetKind =
  (typeof SCENE_FOCUS_LINES_TARGET_KINDS)[number];

export const DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_X_PX = 48;
export const DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_Y_PX = 96;

export type SceneVFXBaseEntry = {
  id: string;
  label: string;
  kind: SceneVFXKind;
  enabled: boolean;
  durationMs?: number | null;
  coverUiOverlays?: boolean;
  dismissOnInput?: boolean;
  sound?: { onApply?: string };
};

export type SceneBackgroundPngLineItem = {
  id: string;
  kind: "png";
  src: string;
  label: string;
};

export type SceneBackgroundSvgLineItem = {
  id: string;
  kind: "svg";
  src: string;
  label: string;
};

export type SceneBackgroundEmojiLineItem = {
  id: string;
  kind: "emoji";
  emoji: string;
  label: string;
  provider?: SceneBackgroundEmojiProvider;
};

export type SceneBackgroundLineItem =
  | SceneBackgroundPngLineItem
  | SceneBackgroundSvgLineItem
  | SceneBackgroundEmojiLineItem;

export type ResolvedSceneBackgroundPngLineItem = SceneBackgroundPngLineItem;
export type ResolvedSceneBackgroundSvgLineItem = SceneBackgroundSvgLineItem;

export type ResolvedSceneBackgroundEmojiLineItem = Omit<
  SceneBackgroundEmojiLineItem,
  "provider"
> & {
  provider: SceneBackgroundEmojiProvider;
  src: string;
};

export type ResolvedSceneBackgroundLineItem =
  | ResolvedSceneBackgroundPngLineItem
  | ResolvedSceneBackgroundSvgLineItem
  | ResolvedSceneBackgroundEmojiLineItem;

export type SceneBackgroundSolidLayer = {
  enabled: boolean;
  color: string;
};

export type SceneBackgroundPatternLayer = {
  enabled: boolean;
  pattern: SceneBackgroundPatternKind;
  color: string;
  size: number;
  spacing: number;
  opacity: number;
};

export type SceneBackgroundMarqueeLayer = {
  enabled: boolean;
  items: SceneBackgroundLineItem[];
  itemSize: number;
  gap: number;
  rowGap: number;
  direction: SceneBackgroundDirection;
  itemRotationMode: SceneBackgroundItemRotationMode;
  itemRotationOffsetDeg: number;
  speedPxPerSec: number;
  opacity: number;
};

export type ResolvedSceneBackgroundMarqueeLayer = Omit<
  SceneBackgroundMarqueeLayer,
  "items"
> & {
  items: ResolvedSceneBackgroundLineItem[];
};

export type SceneBackgroundLayersVFXEntry = SceneVFXBaseEntry & {
  kind: "background_layers";
  solid: SceneBackgroundSolidLayer;
  pattern: SceneBackgroundPatternLayer;
  marquee: SceneBackgroundMarqueeLayer;
};

export type SceneNormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SceneFocusLinesAvatarFaceTarget = {
  kind: "avatar_face";
  paddingXPx: number;
  paddingYPx: number;
};

export type SceneFocusLinesManualBoxTarget = {
  kind: "manual_box";
  rect: SceneNormalizedRect;
};

export type SceneFocusLinesTarget =
  | SceneFocusLinesAvatarFaceTarget
  | SceneFocusLinesManualBoxTarget;

export type SceneFocusLinesAnimation = {
  minVisibleMs: number;
  maxVisibleMs: number;
  minHiddenMs: number;
  maxHiddenMs: number;
  opacityJitter: number;
};

export type SceneFocusLinesVFXEntry = SceneVFXBaseEntry & {
  kind: "focus_lines";
  renderPlacement: SceneFocusLinesRenderPlacement;
  lineCount: number;
  color: string;
  opacity: number;
  baseThicknessPx: number;
  thicknessVariationPx: number;
  lengthVariation: number;
  overscanPx: number;
  target: SceneFocusLinesTarget;
  animation: SceneFocusLinesAnimation;
  seed?: number | null;
};

export type SceneVFXEntry =
  | SceneBackgroundLayersVFXEntry
  | SceneFocusLinesVFXEntry;

export type ResolvedSceneVFXBaseEntry = Omit<
  SceneVFXBaseEntry,
  "durationMs" | "coverUiOverlays" | "dismissOnInput"
> & {
  durationMs: number | null;
  coverUiOverlays: boolean;
  dismissOnInput: boolean;
};

export type ResolvedSceneBackgroundLayersVFXEntry = Omit<
  SceneBackgroundLayersVFXEntry,
  "durationMs" | "coverUiOverlays" | "dismissOnInput" | "marquee"
> &
  ResolvedSceneVFXBaseEntry & {
    marquee: ResolvedSceneBackgroundMarqueeLayer;
  };

export type ResolvedSceneFocusLinesVFXEntry = Omit<
  SceneFocusLinesVFXEntry,
  "durationMs" | "coverUiOverlays" | "dismissOnInput" | "seed"
> &
  ResolvedSceneVFXBaseEntry & {
    seed: number;
  };

export type ResolvedSceneVFXEntry =
  | ResolvedSceneBackgroundLayersVFXEntry
  | ResolvedSceneFocusLinesVFXEntry;

export type SceneVFXRuntimeEntry<
  TEntry extends ResolvedSceneVFXEntry = ResolvedSceneVFXEntry,
> = {
  kind: TEntry["kind"];
  /** Logical catalog identity; `entry.id` may instead be a clip ownership ID. */
  runtimeId?: string;
  entry: TEntry;
  startedAtMs: number;
  expiresAtMs: number | null;
};

export function getSceneVFXRenderBand(
  entry:
    | Pick<SceneBackgroundLayersVFXEntry, "kind">
    | Pick<ResolvedSceneBackgroundLayersVFXEntry, "kind">
    | Pick<SceneFocusLinesVFXEntry, "kind" | "renderPlacement">
    | Pick<ResolvedSceneFocusLinesVFXEntry, "kind" | "renderPlacement">,
): SceneVFXRenderBand {
  if (entry.kind === "focus_lines") {
    return entry.renderPlacement === "front_of_avatar" ? "overlay" : "underlay";
  }

  return "underlay";
}

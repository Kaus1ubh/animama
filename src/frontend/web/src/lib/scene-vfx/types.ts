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

export type SceneBackgroundLineItem =
  | SceneBackgroundPngLineItem
  | SceneBackgroundSvgLineItem;

export type ResolvedSceneBackgroundPngLineItem = SceneBackgroundPngLineItem;
export type ResolvedSceneBackgroundSvgLineItem = SceneBackgroundSvgLineItem;

export type ResolvedSceneBackgroundLineItem =
  | ResolvedSceneBackgroundPngLineItem
  | ResolvedSceneBackgroundSvgLineItem;

/**
 * A marquee or scatter item from before the sticker set: a Twemoji glyph,
 * which Animama no longer provides. A Scene saved with one plays without it,
 * and its creator shows it as missing until it is replaced or removed.
 */
export type SceneLegacyEmojiItem = {
  id: string;
  kind: "emoji";
  label: string;
  emoji: string;
};

/** Whether a stored or runtime item is a legacy Twemoji item. */
export function isSceneLegacyEmojiItem(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "emoji"
  );
}

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

export const SCENE_BACKGROUND_GRADIENT_TYPES = ["linear", "radial"] as const;
export type SceneBackgroundGradientType =
  (typeof SCENE_BACKGROUND_GRADIENT_TYPES)[number];

export type SceneBackgroundGradientStop = {
  color: string;
  /** 0 at the start (or centre), 1 at the end (or edge). */
  position: number;
};

/** C1: a linear or radial gradient over the solid fill. */
export type SceneBackgroundGradientLayer = {
  enabled: boolean;
  type: SceneBackgroundGradientType;
  /** Linear only: the CSS gradient angle (0 runs bottom to top). */
  angleDeg: number;
  /** Radial only: the centre, as fractions of the view. */
  centerX: number;
  centerY: number;
  stops: SceneBackgroundGradientStop[];
};

/** C2: one image repeated over the view, drifting in a marquee direction. */
export type SceneBackgroundTileLayer = {
  enabled: boolean;
  /** The image URL (a stored definition names the image instead). */
  src: string;
  size: number;
  opacity: number;
  direction: SceneBackgroundDirection;
  speedPxPerSec: number;
};

export const SCENE_BACKGROUND_SCREEN_KINDS = ["rays", "lines"] as const;
export type SceneBackgroundScreenKind =
  (typeof SCENE_BACKGROUND_SCREEN_KINDS)[number];

/** C3: rays radiating from a centre, optionally turning and throbbing. */
export type SceneBackgroundRaysScreen = {
  enabled: boolean;
  kind: "rays";
  color: string;
  opacity: number;
  count: number;
  centerX: number;
  centerY: number;
  /** A spiky starburst instead of separate wedges. */
  spiky: boolean;
  /** Seconds per turn; 0 is still, negative turns counter-clockwise. */
  turnSeconds: number;
  /** Throbs (scale pulses) per second; 0 is none. */
  throbPerSec: number;
  seed: number;
};

/** C3: lines hanging from the top edge (1 is full height), optionally swaying. */
export type SceneBackgroundLinesScreen = {
  enabled: boolean;
  kind: "lines";
  color: string;
  opacity: number;
  count: number;
  minLength: number;
  maxLength: number;
  minWidthPx: number;
  maxWidthPx: number;
  /** Seconds per sway; 0 is still. */
  swaySeconds: number;
  seed: number;
};

export type SceneBackgroundScreenLayer =
  | SceneBackgroundRaysScreen
  | SceneBackgroundLinesScreen;

export const SCENE_BACKGROUND_SCATTER_PULSES = [
  "none",
  "twinkle",
  "pop",
  "flicker",
] as const;
export type SceneBackgroundScatterPulse =
  (typeof SCENE_BACKGROUND_SCATTER_PULSES)[number];

/**
 * C4 and C5: items scattered over the view with per-item size, rotation and
 * opacity, drifting, spinning and pulsing. The seed fixes every placement and
 * variation, so a Scene looks the same wherever it plays.
 */
export type SceneBackgroundScatterLayer = {
  enabled: boolean;
  items: SceneBackgroundLineItem[];
  count: number;
  seed: number;
  minSize: number;
  maxSize: number;
  minRotationDeg: number;
  maxRotationDeg: number;
  minOpacity: number;
  maxOpacity: number;
  /** Where items start, as fractions of the view height. */
  regionTop: number;
  regionBottom: number;
  /** Keep items out of the column behind the head. */
  keepFaceClear: boolean;
  direction: SceneBackgroundDirection;
  speedPxPerSec: number;
  minSpinDegPerSec: number;
  maxSpinDegPerSec: number;
  /** Every other item spins the other way. */
  alternateSpin: boolean;
  pulse: SceneBackgroundScatterPulse;
};

export type ResolvedSceneBackgroundScatterLayer = Omit<
  SceneBackgroundScatterLayer,
  "items"
> & {
  items: ResolvedSceneBackgroundLineItem[];
};

/** C6: one fade from a colour when the Scene starts. */
export type SceneBackgroundFlashLayer = {
  enabled: boolean;
  color: string;
  durationMs: number;
};

export type SceneBackgroundLayersVFXEntry = SceneVFXBaseEntry & {
  kind: "background_layers";
  solid: SceneBackgroundSolidLayer;
  pattern: SceneBackgroundPatternLayer;
  marquee: SceneBackgroundMarqueeLayer;
  /** Optional layers (an absent one is off), drawn in this order. */
  gradient?: SceneBackgroundGradientLayer;
  tile?: SceneBackgroundTileLayer;
  screen?: SceneBackgroundScreenLayer;
  scatters?: SceneBackgroundScatterLayer[];
  flash?: SceneBackgroundFlashLayer;
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
  "durationMs" | "coverUiOverlays" | "dismissOnInput" | "marquee" | "scatters"
> &
  ResolvedSceneVFXBaseEntry & {
    marquee: ResolvedSceneBackgroundMarqueeLayer;
    scatters?: ResolvedSceneBackgroundScatterLayer[];
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

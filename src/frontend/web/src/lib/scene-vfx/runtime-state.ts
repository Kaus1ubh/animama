import { resolveSceneBackgroundLineItem } from "@/lib/scene-vfx/assets";
import { hashStringToSeed } from "@/lib/scene-vfx/focus-lines";
import {
  DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_X_PX,
  DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_Y_PX,
  getSceneVFXRenderBand,
  type ResolvedSceneBackgroundLineItem,
  type ResolvedSceneBackgroundLayersVFXEntry,
  type ResolvedSceneFocusLinesVFXEntry,
  type ResolvedSceneVFXEntry,
  type SceneBackgroundLayersVFXEntry,
  type SceneFocusLinesVFXEntry,
  type SceneVFXEntry,
  type SceneVFXKind,
  type SceneVFXRuntimeEntry,
} from "@/lib/scene-vfx/types";

type SceneVFXEntryByKind = {
  background_layers: ResolvedSceneBackgroundLayersVFXEntry;
  focus_lines: ResolvedSceneFocusLinesVFXEntry;
};

export type SceneVFXActiveByKind = {
  [K in SceneVFXKind]?: SceneVFXRuntimeEntry<SceneVFXEntryByKind[K]>;
};

export type SceneVFXRuntimeState = {
  activeByKind: SceneVFXActiveByKind;
  coverUiOverlaysActive: boolean;
  underlayCoverUiOverlaysActive: boolean;
  overlayCoverUiOverlaysActive: boolean;
};

/** Project the single-effect preview model into the renderer's keyed shape. */
export function sceneVFXActiveByKind(
  runtimeEntry: SceneVFXRuntimeEntry | null,
): SceneVFXActiveByKind {
  if (!runtimeEntry) return {};
  if (runtimeEntry.entry.kind === "focus_lines") {
    return {
      focus_lines:
        runtimeEntry as SceneVFXRuntimeEntry<ResolvedSceneFocusLinesVFXEntry>,
    };
  }
  return {
    background_layers:
      runtimeEntry as SceneVFXRuntimeEntry<ResolvedSceneBackgroundLayersVFXEntry>,
  };
}

const DEFAULT_SCENE_VFX_DURATION_MS = 5000;
const DEFAULT_SCENE_VFX_COVER_UI_OVERLAYS = false;
const DEFAULT_SCENE_VFX_DISMISS_ON_INPUT = true;
const DEFAULT_FOCUS_LINES_DISMISS_ON_INPUT = false;
const DEFAULT_FOCUS_LINES_LINE_COUNT = 100;
const MIN_FOCUS_LINES_LINE_COUNT = 50;
const MAX_FOCUS_LINES_LINE_COUNT = 200;

function isResolvedSceneBackgroundLineItem(
  item: ResolvedSceneBackgroundLineItem | null,
): item is ResolvedSceneBackgroundLineItem {
  return item !== null;
}

function clampFinite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampDurationMs(value: number | null | undefined): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  return DEFAULT_SCENE_VFX_DURATION_MS;
}

function resolveSceneBackgroundLayersEntry(
  entry: SceneBackgroundLayersVFXEntry,
): ResolvedSceneBackgroundLayersVFXEntry {
  return {
    ...entry,
    durationMs: clampDurationMs(entry.durationMs),
    coverUiOverlays:
      entry.coverUiOverlays ?? DEFAULT_SCENE_VFX_COVER_UI_OVERLAYS,
    dismissOnInput: entry.dismissOnInput ?? DEFAULT_SCENE_VFX_DISMISS_ON_INPUT,
    solid: { ...entry.solid },
    pattern: { ...entry.pattern },
    marquee: {
      ...entry.marquee,
      itemRotationMode: entry.marquee.itemRotationMode ?? "upright",
      itemRotationOffsetDeg:
        typeof entry.marquee.itemRotationOffsetDeg === "number" &&
        Number.isFinite(entry.marquee.itemRotationOffsetDeg)
          ? entry.marquee.itemRotationOffsetDeg
          : 0,
      items: entry.marquee.items
        .map(resolveSceneBackgroundLineItem)
        .filter(isResolvedSceneBackgroundLineItem),
    },
  };
}

function resolveSceneFocusLinesEntry(
  entry: SceneFocusLinesVFXEntry,
): ResolvedSceneFocusLinesVFXEntry {
  const avatarFaceTarget =
    entry.target.kind === "avatar_face"
      ? (entry.target as unknown as { paddingPx?: unknown } & {
          paddingXPx?: number;
          paddingYPx?: number;
        })
      : null;
  const legacyPaddingPx =
    typeof avatarFaceTarget?.paddingPx === "number"
      ? avatarFaceTarget.paddingPx
      : undefined;

  return {
    ...entry,
    durationMs: clampDurationMs(entry.durationMs),
    coverUiOverlays:
      entry.coverUiOverlays ?? DEFAULT_SCENE_VFX_COVER_UI_OVERLAYS,
    dismissOnInput:
      entry.dismissOnInput ?? DEFAULT_FOCUS_LINES_DISMISS_ON_INPUT,
    lineCount: Math.max(
      MIN_FOCUS_LINES_LINE_COUNT,
      Math.min(
        MAX_FOCUS_LINES_LINE_COUNT,
        Math.round(
          clampFinite(entry.lineCount, DEFAULT_FOCUS_LINES_LINE_COUNT),
        ),
      ),
    ),
    opacity: Math.max(0, Math.min(1, clampFinite(entry.opacity, 0.92))),
    baseThicknessPx: Math.max(
      1,
      Math.min(48, clampFinite(entry.baseThicknessPx, 10)),
    ),
    thicknessVariationPx: Math.max(
      0,
      Math.min(32, clampFinite(entry.thicknessVariationPx, 5)),
    ),
    lengthVariation: Math.max(
      0,
      Math.min(0.75, clampFinite(entry.lengthVariation, 0.18)),
    ),
    overscanPx: Math.max(0, Math.min(256, clampFinite(entry.overscanPx, 48))),
    target:
      entry.target.kind === "manual_box"
        ? { kind: "manual_box", rect: { ...entry.target.rect } }
        : {
            kind: "avatar_face",
            paddingXPx: Math.max(
              0,
              Math.min(
                240,
                clampFinite(
                  avatarFaceTarget?.paddingXPx,
                  legacyPaddingPx ??
                    DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_X_PX,
                ),
              ),
            ),
            paddingYPx: Math.max(
              0,
              Math.min(
                240,
                clampFinite(
                  avatarFaceTarget?.paddingYPx,
                  legacyPaddingPx != null
                    ? legacyPaddingPx * 2
                    : DEFAULT_SCENE_FOCUS_LINES_FACE_PADDING_Y_PX,
                ),
              ),
            ),
          },
    animation: {
      minVisibleMs: Math.max(40, clampFinite(entry.animation.minVisibleMs, 90)),
      maxVisibleMs: Math.max(
        Math.max(40, clampFinite(entry.animation.minVisibleMs, 90)),
        clampFinite(entry.animation.maxVisibleMs, 280),
      ),
      minHiddenMs: Math.max(0, clampFinite(entry.animation.minHiddenMs, 50)),
      maxHiddenMs: Math.max(
        Math.max(0, clampFinite(entry.animation.minHiddenMs, 50)),
        clampFinite(entry.animation.maxHiddenMs, 200),
      ),
      opacityJitter: Math.max(
        0,
        Math.min(1, clampFinite(entry.animation.opacityJitter, 0.18)),
      ),
    },
    seed:
      typeof entry.seed === "number" && Number.isFinite(entry.seed)
        ? Math.round(entry.seed) >>> 0
        : hashStringToSeed(entry.id),
  };
}

/** Normalize one trusted catalog definition into bounded render state. */
export function resolveSceneVFXEntry(
  entry: SceneVFXEntry,
): ResolvedSceneVFXEntry {
  return entry.kind === "focus_lines"
    ? resolveSceneFocusLinesEntry(entry)
    : resolveSceneBackgroundLayersEntry(entry);
}

/** Stamp one normalized scene effect without touching the live Zustand store. */
export function buildSceneVFXRuntimeEntry(
  entry: SceneVFXEntry,
  nowMs = Date.now(),
  runtimeId = entry.id,
): SceneVFXRuntimeEntry<ResolvedSceneVFXEntry> {
  const resolvedEntry = resolveSceneVFXEntry(entry);
  return {
    kind: resolvedEntry.kind,
    runtimeId,
    entry: resolvedEntry,
    startedAtMs: nowMs,
    expiresAtMs:
      resolvedEntry.durationMs === null
        ? null
        : resolvedEntry.durationMs > 0
          ? nowMs + resolvedEntry.durationMs
          : nowMs,
  };
}

function computeBandCoverState(args: {
  activeByKind: SceneVFXActiveByKind;
  band: "underlay" | "overlay";
}): boolean {
  return Object.values(args.activeByKind).some(
    (runtimeEntry) =>
      Boolean(runtimeEntry?.entry.coverUiOverlays) &&
      getSceneVFXRenderBand(runtimeEntry!.entry) === args.band,
  );
}

/** Derive the presentation flags shared by live and preview scene adapters. */
export function buildSceneVFXRuntimeState(
  activeByKind: SceneVFXActiveByKind,
): SceneVFXRuntimeState {
  const underlayCoverUiOverlaysActive = computeBandCoverState({
    activeByKind,
    band: "underlay",
  });
  const overlayCoverUiOverlaysActive = computeBandCoverState({
    activeByKind,
    band: "overlay",
  });
  return {
    activeByKind,
    coverUiOverlaysActive:
      underlayCoverUiOverlaysActive || overlayCoverUiOverlaysActive,
    underlayCoverUiOverlaysActive,
    overlayCoverUiOverlaysActive,
  };
}

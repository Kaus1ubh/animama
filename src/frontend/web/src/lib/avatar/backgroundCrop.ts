import type { SettingsPreferences } from "@/lib/settings/preferences";
import type { AvatarBackgroundOption } from "./backgroundOptions";

const DEFAULT_FOCAL_X = 0.5;
const DEFAULT_FOCAL_Y = 0.5;
const DEFAULT_ZOOM = 1;
const MIN_FRAME_SIZE = 1;

export const MAX_AVATAR_BACKGROUND_ZOOM = 4;

export type AvatarBackgroundCrop = {
  backgroundId: string;
  focalX: number;
  focalY: number;
  zoom: number;
};

export type AvatarBackgroundLayout = {
  width: number;
  height: number;
  left: number;
  top: number;
  scale: number;
  baseScale: number;
};

type AvatarBackgroundLayoutParams = {
  option: AvatarBackgroundOption;
  crop: AvatarBackgroundCrop;
  frameWidth: number;
  frameHeight: number;
};

type AvatarBackgroundDragParams = AvatarBackgroundLayoutParams & {
  deltaX: number;
  deltaY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBackgroundId(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createDefaultAvatarBackgroundCrop(
  backgroundId: string,
): AvatarBackgroundCrop {
  return {
    backgroundId,
    focalX: DEFAULT_FOCAL_X,
    focalY: DEFAULT_FOCAL_Y,
    zoom: DEFAULT_ZOOM,
  };
}

export function clampAvatarBackgroundZoom(zoom: number): number {
  return clamp(zoom, DEFAULT_ZOOM, MAX_AVATAR_BACKGROUND_ZOOM);
}

export function normalizeAvatarBackgroundCrop(
  backgroundId: string,
  crop?: Partial<AvatarBackgroundCrop> | null,
): AvatarBackgroundCrop {
  return {
    backgroundId,
    focalX: clamp(toFiniteNumber(crop?.focalX, DEFAULT_FOCAL_X), 0, 1),
    focalY: clamp(toFiniteNumber(crop?.focalY, DEFAULT_FOCAL_Y), 0, 1),
    zoom: clampAvatarBackgroundZoom(toFiniteNumber(crop?.zoom, DEFAULT_ZOOM)),
  };
}

export function readAvatarBackgroundCrop(
  preferences?: SettingsPreferences | null,
): AvatarBackgroundCrop | null {
  const presentation = isRecord(preferences?.presentation)
    ? preferences.presentation
    : null;
  const raw = isRecord(presentation?.avatar_background)
    ? presentation.avatar_background
    : null;
  if (!raw) return null;

  const backgroundId = normalizeBackgroundId(
    typeof raw.background_id === "string" ? raw.background_id : null,
  );
  if (!backgroundId) return null;

  return normalizeAvatarBackgroundCrop(backgroundId, {
    backgroundId,
    focalX: toFiniteNumber(raw.focal_x, DEFAULT_FOCAL_X),
    focalY: toFiniteNumber(raw.focal_y, DEFAULT_FOCAL_Y),
    zoom: toFiniteNumber(raw.zoom, DEFAULT_ZOOM),
  });
}

export function writeAvatarBackgroundCrop(
  preferences: SettingsPreferences | null | undefined,
  crop: AvatarBackgroundCrop | null,
): SettingsPreferences {
  const base = isRecord(preferences) ? preferences : {};
  const presentation = isRecord(base.presentation)
    ? { ...base.presentation }
    : {};

  presentation.avatar_background = crop
    ? {
        background_id: crop.backgroundId,
        focal_x: crop.focalX,
        focal_y: crop.focalY,
        zoom: crop.zoom,
      }
    : null;

  return {
    ...base,
    presentation,
  };
}

export function resolveAvatarBackgroundCrop(
  option: AvatarBackgroundOption,
  preferences?: SettingsPreferences | null,
): AvatarBackgroundCrop {
  const stored = readAvatarBackgroundCrop(preferences);
  if (!stored || stored.backgroundId !== option.id) {
    return createDefaultAvatarBackgroundCrop(option.id);
  }
  return normalizeAvatarBackgroundCrop(option.id, stored);
}

export function getAvatarBackgroundLayout({
  option,
  crop,
  frameWidth,
  frameHeight,
}: AvatarBackgroundLayoutParams): AvatarBackgroundLayout | null {
  if (frameWidth < MIN_FRAME_SIZE || frameHeight < MIN_FRAME_SIZE) {
    return null;
  }

  const resolvedCrop = normalizeAvatarBackgroundCrop(option.id, crop);
  const baseScale = Math.max(
    frameWidth / option.width,
    frameHeight / option.height,
  );
  const scale = baseScale * resolvedCrop.zoom;
  const width = option.width * scale;
  const height = option.height * scale;
  const left = clamp(
    frameWidth / 2 - resolvedCrop.focalX * width,
    frameWidth - width,
    0,
  );
  const top = clamp(
    frameHeight / 2 - resolvedCrop.focalY * height,
    frameHeight - height,
    0,
  );

  return {
    width,
    height,
    left,
    top,
    scale,
    baseScale,
  };
}

export function applyAvatarBackgroundDrag({
  option,
  crop,
  frameWidth,
  frameHeight,
  deltaX,
  deltaY,
}: AvatarBackgroundDragParams): AvatarBackgroundCrop {
  const resolvedCrop = normalizeAvatarBackgroundCrop(option.id, crop);
  const layout = getAvatarBackgroundLayout({
    option,
    crop: resolvedCrop,
    frameWidth,
    frameHeight,
  });
  if (!layout) return resolvedCrop;

  const nextLeft = clamp(layout.left + deltaX, frameWidth - layout.width, 0);
  const nextTop = clamp(layout.top + deltaY, frameHeight - layout.height, 0);

  return {
    ...resolvedCrop,
    focalX: clamp((frameWidth / 2 - nextLeft) / layout.width, 0, 1),
    focalY: clamp((frameHeight / 2 - nextTop) / layout.height, 0, 1),
  };
}

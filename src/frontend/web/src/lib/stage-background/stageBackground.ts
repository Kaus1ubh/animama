import { publicResourceUrl } from "@/lib/resource-urls";
import type { SettingsPreferences } from "@/lib/settings/preferences";

/**
 * Where a stage is drawn: the chat stage uses the Anima's chosen scene; the
 * Anima page showcase always uses the Dreamy pedestal so every Anima is
 * presented the same way.
 */
export type StageBackgroundVariant = "chat" | "showcase";

export type StageTheme = "light" | "dark";

/** App stage scenes, in dropdown order; each ships a light and a dark image. */
export const STAGE_SCENES = [
  { id: "dreamy", label: "Dreamy" },
  { id: "bedroom", label: "Bedroom" },
  { id: "sakura", label: "Sakura" },
  { id: "seaside", label: "Seaside" },
  { id: "rooftop", label: "Rooftop" },
  { id: "cafe", label: "Café" },
  { id: "classroom", label: "Classroom" },
] as const;

export type StageSceneId = (typeof STAGE_SCENES)[number]["id"];

/** A scene, or `"none"` for the plain theme background. */
export type StageSceneChoice = StageSceneId | "none";

export const DEFAULT_STAGE_SCENE: StageSceneId = "dreamy";

/**
 * What to draw behind the Avatar. In chat an Anima's bound background image
 * wins, otherwise its chosen app scene, unless it chose none.
 */
export type StageBackground =
  | { kind: "bound" }
  | { kind: "app"; src: string }
  | { kind: "none" };

function isStageSceneId(value: unknown): value is StageSceneId {
  return STAGE_SCENES.some((scene) => scene.id === value);
}

export function appStageBackgroundUrl(
  scene: StageSceneId,
  theme: StageTheme,
): string {
  return publicResourceUrl(`background/${scene}-${theme}.webp`);
}

/** The fixed Anima page backdrop: Dreamy's pedestal in the current theme. */
export function showcaseBackgroundUrl(theme: StageTheme): string {
  return publicResourceUrl(`background/dreamy-pedestal-${theme}.webp`);
}

/**
 * The Anima's stored `presentation.stage_background`; missing or unknown
 * values fall back to the default scene.
 */
export function stageSceneChoice(
  preferences: SettingsPreferences | null | undefined,
): StageSceneChoice {
  const value = preferences?.presentation?.stage_background;
  if (value === "none") return "none";
  return isStageSceneId(value) ? value : DEFAULT_STAGE_SCENE;
}

export function resolveStageBackground({
  hasBoundImage,
  scene,
  variant,
  theme,
}: {
  hasBoundImage: boolean;
  scene: StageSceneChoice;
  variant: StageBackgroundVariant;
  theme: StageTheme;
}): StageBackground {
  if (variant === "showcase")
    return { kind: "app", src: showcaseBackgroundUrl(theme) };
  if (hasBoundImage) return { kind: "bound" };
  if (scene === "none") return { kind: "none" };
  return { kind: "app", src: appStageBackgroundUrl(scene, theme) };
}

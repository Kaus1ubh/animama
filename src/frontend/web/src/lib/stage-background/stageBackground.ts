import { publicResourceUrl } from "@/lib/resource-urls";
import type { SettingsPreferences } from "@/lib/settings/preferences";

/**
 * Where a stage is drawn: the chat stage frames a waist-up Avatar on a wide
 * window, the showcase stage frames a full-body Avatar on the Anima page.
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
 * What to draw behind the Avatar. An Anima's bound background image wins;
 * otherwise its chosen app scene, unless it chose none.
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
  variant: StageBackgroundVariant,
  theme: StageTheme,
): string {
  // The light Dreamy showcase has its own pedestal image under the Avatar.
  const file =
    scene === "dreamy" && variant === "showcase" && theme === "light"
      ? "dreamy-pedestal"
      : `${scene}-${theme}`;
  return publicResourceUrl(`background/${file}.webp`);
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
  if (hasBoundImage) return { kind: "bound" };
  if (scene === "none") return { kind: "none" };
  return { kind: "app", src: appStageBackgroundUrl(scene, variant, theme) };
}

import { publicResourceUrl } from "@/lib/resource-urls";
import type { SettingsPreferences } from "@/lib/settings/preferences";

/**
 * Where a stage is drawn: the chat stage frames a waist-up Avatar on a wide
 * window, the showcase stage frames a full-body Avatar on a pedestal.
 */
export type StageBackgroundVariant = "chat" | "showcase";

export type StageTheme = "light" | "dark";

/**
 * What to draw behind the Avatar. An Anima's bound background image wins;
 * otherwise the app stage image is used unless the Anima turned it off.
 */
export type StageBackground =
  | { kind: "bound" }
  | { kind: "app"; src: string }
  | { kind: "none" };

const APP_STAGE_BACKGROUND_PATHS: Record<
  StageBackgroundVariant,
  Record<StageTheme, string>
> = {
  chat: {
    light: "background/stage-day.webp",
    dark: "background/stage-night.webp",
  },
  showcase: {
    light: "background/stage-pedestal.webp",
    dark: "background/stage-night.webp",
  },
};

export function appStageBackgroundUrl(
  variant: StageBackgroundVariant,
  theme: StageTheme,
): string {
  return publicResourceUrl(APP_STAGE_BACKGROUND_PATHS[variant][theme]);
}

/** Per-Anima off switch stored as `presentation.disable_background`. */
export function isStageBackgroundDisabled(
  preferences: SettingsPreferences | null | undefined,
): boolean {
  return preferences?.presentation?.disable_background === true;
}

export function resolveStageBackground({
  hasBoundImage,
  disabled,
  variant,
  theme,
}: {
  hasBoundImage: boolean;
  disabled: boolean;
  variant: StageBackgroundVariant;
  theme: StageTheme;
}): StageBackground {
  if (hasBoundImage) return { kind: "bound" };
  if (disabled) return { kind: "none" };
  return { kind: "app", src: appStageBackgroundUrl(variant, theme) };
}

import type { SettingsPreferences } from "@/lib/settings/preferences";

/**
 * Memory and emotion behaviour that App Settings sets as installation-wide
 * defaults and each Anima may override.
 *
 * Preferences store negative flags (`disable_*`). An Anima that omits a flag
 * inherits the owner's App Settings value; the backend resolves request, then
 * Anima, then owner, then the enabled system default.
 */
export const BEHAVIOR_FLAGS = [
  "memory_influence",
  "memory_updates",
  "emotion_updates",
] as const;
export type BehaviorFlag = (typeof BEHAVIOR_FLAGS)[number];
export type BehaviorOverride = "inherit" | "on" | "off";

const FLAG_LOCATION: Record<
  BehaviorFlag,
  {
    section: "memory" | "emotion";
    key: "disable_influence" | "disable_updates";
  }
> = {
  memory_influence: { section: "memory", key: "disable_influence" },
  memory_updates: { section: "memory", key: "disable_updates" },
  emotion_updates: { section: "emotion", key: "disable_updates" },
};

function storedDisable(
  preferences: SettingsPreferences | null | undefined,
  flag: BehaviorFlag,
): boolean | undefined {
  const { section, key } = FLAG_LOCATION[flag];
  const value = preferences?.[section]?.[key];
  return typeof value === "boolean" ? value : undefined;
}

/** Whether a behaviour is enabled at the App Settings level (default on). */
export function appBehaviorEnabled(
  preferences: SettingsPreferences | null | undefined,
  flag: BehaviorFlag,
): boolean {
  return storedDisable(preferences, flag) !== true;
}

/** An Anima's own choice for a behaviour, or "inherit" when it has none. */
export function animaBehaviorOverride(
  preferences: SettingsPreferences | null | undefined,
  flag: BehaviorFlag,
): BehaviorOverride {
  const disabled = storedDisable(preferences, flag);
  if (disabled === undefined) return "inherit";
  return disabled ? "off" : "on";
}

/** The behaviour an Anima actually uses. */
export function effectiveBehaviorEnabled(
  appPreferences: SettingsPreferences | null | undefined,
  animaPreferences: SettingsPreferences | null | undefined,
  flag: BehaviorFlag,
): boolean {
  const override = animaBehaviorOverride(animaPreferences, flag);
  if (override === "inherit") return appBehaviorEnabled(appPreferences, flag);
  return override === "on";
}

/**
 * Preferences patch for a choice. "inherit" removes the stored flag (undefined
 * is dropped when preferences are serialized). Turning memory influence off
 * also turns memory updates off, matching the existing rule that memory
 * cannot be written while it is not read.
 */
export function behaviorPatch(
  flag: BehaviorFlag,
  choice: BehaviorOverride,
): SettingsPreferences {
  const { section, key } = FLAG_LOCATION[flag];
  const value = choice === "inherit" ? undefined : choice === "off";
  const patch: Record<string, boolean | undefined> = { [key]: value };
  if (flag === "memory_influence" && choice === "off") {
    patch.disable_updates = true;
  }
  return { [section]: patch };
}

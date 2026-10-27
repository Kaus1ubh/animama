import type { TFunction } from "i18next";

import type {
  AvatarMaterialMode,
  AvatarSpringMode,
} from "@/lib/avatar/avatarSettings";

/** A wind setting as the settings panel and Diagnostics name it. */
export function springModeLabel(
  t: TFunction<"settings">,
  mode: AvatarSpringMode,
): string {
  switch (mode) {
    case "automatic":
      return t("animaSettings.avatar.wind.modes.automatic");
    case "on":
      return t("animaSettings.avatar.wind.modes.on");
    case "off":
      return t("animaSettings.avatar.wind.modes.off");
    case "springs_off":
      return t("animaSettings.avatar.wind.modes.springs_off");
  }
}

/** A material setting as the settings panel and Diagnostics name it. */
export function materialModeLabel(
  t: TFunction<"settings">,
  mode: AvatarMaterialMode,
): string {
  switch (mode) {
    case "automatic":
      return t("animaSettings.avatar.materials.modes.automatic");
    case "liltoon":
      return t("animaSettings.avatar.materials.modes.liltoon");
    case "simple":
      return t("animaSettings.avatar.materials.modes.simple");
  }
}

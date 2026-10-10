import { getI18n } from "react-i18next";

/**
 * Product label for a package item kind, shared by the picker and immutable
 * package reviews. `count` selects the plural ("Gestures") where a language has one.
 */
export function sharingKindLabel(kind: string, count = 1): string {
  const t = getI18n().getFixedT(null, "library");
  switch (kind) {
    case "avatar":
      return t("sharing.kinds.avatar", { count });
    case "gesture":
      return t("sharing.kinds.gesture", { count });
    case "reaction":
      return t("sharing.kinds.reaction", { count });
    case "pose":
      return t("sharing.kinds.pose", { count });
    case "idle_style":
      return t("sharing.kinds.idleStyle", { count });
    case "particle_effect":
      return t("sharing.kinds.particleEffect", { count });
    case "avatar_effect":
      return t("sharing.kinds.avatarEffect", { count });
    case "scene_effect":
      return t("sharing.kinds.sceneEffect", { count });
    case "sound_effect":
      return t("sharing.kinds.soundEffect", { count });
    case "voice":
      return t("sharing.kinds.voice", { count });
    case "appearance":
      return t("sharing.kinds.image", { count });
    default:
      return t("sharing.kinds.content", { count });
  }
}

export type PackageDisplayItem = {
  id: string;
  name: string;
  kind: string;
  selected?: boolean;
  originalName?: string;
};

/** A drop supplies one package to the same file flow used by the chooser. */
export function sharingDropSelection(files: ArrayLike<File>): {
  file: File | null;
  error: string | null;
} {
  const t = getI18n().getFixedT(null, "library");
  if (files.length > 1)
    return { file: null, error: t("sharing.import.oneFileAtATime") };
  return { file: files[0] ?? null, error: null };
}

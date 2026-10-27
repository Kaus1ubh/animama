import { create } from "zustand";

/**
 * Per-Avatar settings an owner keeps outside the file (one row per owner and
 * Avatar item, `GET/PUT /v1/avatar-content/{item_id}/settings`). A missing or
 * unreadable value means Automatic.
 */

/**
 * Wind and spring physics. Automatic keeps today's choice (no wind or updraft
 * on Avatars converted by Mochiya, whose springs rely on their modelled
 * shape); On and Off force ambient forces; Springs off also holds every spring
 * joint at rest.
 */
export type AvatarSpringMode = "automatic" | "on" | "off" | "springs_off";

/**
 * How authored lilToon materials render. Automatic is lilToon (a GPU check
 * comes later); Simple uses the file's glTF fallback materials, which cost far
 * less per frame.
 */
export type AvatarMaterialMode = "automatic" | "liltoon" | "simple";

export const AVATAR_SPRING_MODES: readonly AvatarSpringMode[] = [
  "automatic",
  "on",
  "off",
  "springs_off",
];

export const AVATAR_MATERIAL_MODES: readonly AvatarMaterialMode[] = [
  "automatic",
  "liltoon",
  "simple",
];

/**
 * Whether wind and updraft apply. `automaticAmbientForces` is Automatic's
 * answer for this file (false for springs tuned without them).
 */
export function resolveAmbientForces(
  mode: AvatarSpringMode,
  automaticAmbientForces: boolean,
): boolean {
  switch (mode) {
    case "automatic":
      return automaticAmbientForces;
    case "on":
      return true;
    case "off":
    case "springs_off":
      return false;
  }
}

/** Whether lilToon materials load under a mode. */
export function rendersLilToon(mode: AvatarMaterialMode): boolean {
  return mode !== "simple";
}

type AvatarFileTraitsState = {
  /** Whether a VRM file declares authored lilToon materials, by its sha256. */
  lilToonBySha256: Readonly<Record<string, boolean>>;
};

/**
 * What loaded Avatar files are known to contain, so settings can offer the
 * Materials choice only for files with lilToon materials. `Avatar.load` fills
 * it; a file no surface has loaded yet is unknown.
 */
export const useAvatarFileTraitsStore = create<AvatarFileTraitsState>(() => ({
  lilToonBySha256: {},
}));

/** Record a loaded file's lilToon use (`Avatar.load`). */
export function rememberAvatarFileLilToon(
  vrmSha256: string,
  usesLilToon: boolean,
): void {
  const known = useAvatarFileTraitsStore.getState().lilToonBySha256;
  if (known[vrmSha256] === usesLilToon) return;
  useAvatarFileTraitsStore.setState({
    lilToonBySha256: { ...known, [vrmSha256]: usesLilToon },
  });
}

/** Whether a file has lilToon materials: undefined until one has loaded. */
export function useAvatarFileUsesLilToon(
  vrmSha256: string | null,
): boolean | undefined {
  return useAvatarFileTraitsStore((state) =>
    vrmSha256 ? state.lilToonBySha256[vrmSha256] : undefined,
  );
}

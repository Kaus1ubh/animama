/** Synthetic runtime Avatar Effect entries for tests; there is no bundled catalog. */
import { parseAvatarEffectDefinition } from "./definition";
import type { AvatarHoverVFXEntry } from "./types";

/** A resolved forehead landmark, as the runtime catalog projects an Included effect. */
export const TEST_HOVER_VFX_ENTRY = parseAvatarEffectDefinition(
  {
    schema: "animama/avatar-effect/2",
    region: "emote",
    attachment: {
      kind: "face_landmark",
      landmark: "forehead",
      position: "left",
    },
    art: { image: "test-hover-effect.png" },
  },
  {
    id: "test-hover-effect",
    label: "Test hover",
    description: "Synthetic box hover used by runtime tests.",
    assetPath: "blob:test-hover-effect",
  },
) as AvatarHoverVFXEntry;

/** Synthetic runtime Avatar Effect entries for tests; there is no bundled catalog. */
import { parseAvatarVFXCatalogEntry } from "./catalog";
import type { AvatarHoverVFXEntry } from "./types";

/** A resolved box hover, as the runtime catalog projects an Included effect. */
export const TEST_HOVER_VFX_ENTRY = parseAvatarVFXCatalogEntry({
  id: "test-hover-effect",
  label: "Test hover",
  description: "Synthetic box hover used by runtime tests.",
  assetPath: "blob:test-hover-effect",
  kind: "hover",
  region: "emote",
  hoverKind: "box_hover",
  placement: "forehead-left",
}) as AvatarHoverVFXEntry;

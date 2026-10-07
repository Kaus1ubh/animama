import type { Avatar } from "../Avatar";
import {
  isDeferredAttachmentVFXEntry,
  isFaceAnchoredVFXEntry,
  isHoverVFXEntry,
  isTextureVFXEntry,
  type AvatarVFXCatalogEntry,
  type AvatarVFXParsedEntry,
} from "./types";

/**
 * Apply one resolved Avatar Effect. Callers resolve `effectEntry` through the
 * Anima's runtime catalog; there is no bundled fallback catalog. Returns false
 * when nothing was applied, including an effect skipped because the Avatar
 * lacks its face part (`findUnavailableFacePart` tells the cases apart).
 */
export async function applyAvatarVFXEffectById(args: {
  avatar: Avatar | null;
  effectId: string;
  appliedEffectId?: string;
  effectEntry: AvatarVFXParsedEntry | null;
}): Promise<boolean> {
  const effect = args.effectEntry;
  const controller = args.avatar?.vfxController ?? null;

  if (!effect || !controller) {
    return false;
  }

  const runtimeEffectId = args.appliedEffectId ?? effect.id;

  // An effect whose face part this Avatar lacks is not applied; the
  // controller logs it once and lists it in its warnings.
  const missingPart = controller.findUnavailableFacePart(effect);
  if (missingPart) {
    controller.reportUnavailableFacePart(effect, missingPart);
    return false;
  }

  if (isDeferredAttachmentVFXEntry(effect)) {
    // Body, sticker and silhouette effects are valid but not rendered yet.
    controller.reportUnsupportedAttachment(effect);
    return false;
  }

  if (isHoverVFXEntry(effect)) {
    await controller.applyHoverVFX({
      effectId: runtimeEffectId,
      effectEntry: withRuntimeAvatarVFXId(effect, runtimeEffectId),
      logicalEffectId: effect.id,
    });
    return true;
  }

  if (isFaceAnchoredVFXEntry(effect)) {
    await controller.applyFaceAnchoredVFX({
      effectId: runtimeEffectId,
      effectEntry: withRuntimeAvatarVFXId(effect, runtimeEffectId),
      logicalEffectId: effect.id,
    });
    return true;
  }

  if (isTextureVFXEntry(effect)) {
    await controller.applyTextureVFX({
      effectId: runtimeEffectId,
      effectEntry: withRuntimeAvatarVFXId(effect, runtimeEffectId),
      logicalEffectId: effect.id,
    });
    return true;
  }

  return false;
}

function withRuntimeAvatarVFXId<TEntry extends AvatarVFXCatalogEntry>(
  effect: TEntry,
  appliedEffectId: string,
): TEntry {
  return {
    ...effect,
    id: appliedEffectId,
  };
}

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
 * Anima's runtime catalog; there is no bundled fallback catalog.
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

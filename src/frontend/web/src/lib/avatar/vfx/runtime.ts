import type { Avatar } from "../Avatar";
import { AVATAR_VFX_CATALOG } from "./catalog";
import {
  isFaceAnchoredVFXEntry,
  isHoverVFXEntry,
  isTextureVFXEntry,
  type AvatarVFXCatalogEntry,
} from "./types";

const AVATAR_VFX_CATALOG_BY_ID = new Map<string, AvatarVFXCatalogEntry>(
  AVATAR_VFX_CATALOG.map((entry) => [entry.id, entry]),
);

export function getAvatarVFXCatalogEntryById(
  effectId: string,
): AvatarVFXCatalogEntry | null {
  return AVATAR_VFX_CATALOG_BY_ID.get(effectId) ?? null;
}

export async function applyAvatarVFXEffectById(args: {
  avatar: Avatar | null;
  effectId: string;
  appliedEffectId?: string;
  effectEntry?: AvatarVFXCatalogEntry | null;
}): Promise<boolean> {
  const effect =
    args.effectEntry === undefined
      ? getAvatarVFXCatalogEntryById(args.effectId)
      : args.effectEntry;
  const controller = args.avatar?.vfxController ?? null;

  if (!effect || !controller) {
    return false;
  }

  const runtimeEffectId = args.appliedEffectId ?? effect.id;

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

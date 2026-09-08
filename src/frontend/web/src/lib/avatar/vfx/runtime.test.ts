import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { AVATAR_VFX_CATALOG } from "./catalog";
import { applyAvatarVFXEffectById } from "./runtime";
import { isHoverVFXEntry } from "./types";

describe("applyAvatarVFXEffectById", () => {
  it("does not fall back to the built-in catalog when live resolution returns null", async () => {
    const controller = {
      applyHoverVFX: vi.fn(),
      applyFaceAnchoredVFX: vi.fn(),
      applyTextureVFX: vi.fn(),
    };
    const avatar = { vfxController: controller } as unknown as Avatar;
    const builtIn = AVATAR_VFX_CATALOG[0];
    expect(builtIn).toBeDefined();

    await expect(
      applyAvatarVFXEffectById({
        avatar,
        effectId: builtIn!.id,
        effectEntry: null,
      }),
    ).resolves.toBe(false);
    expect(controller.applyHoverVFX).not.toHaveBeenCalled();
    expect(controller.applyFaceAnchoredVFX).not.toHaveBeenCalled();
    expect(controller.applyTextureVFX).not.toHaveBeenCalled();
  });

  it("keeps logical effect identity separate from its replaceable applied ID", async () => {
    const controller = {
      applyHoverVFX: vi.fn(),
      applyFaceAnchoredVFX: vi.fn(),
      applyTextureVFX: vi.fn(),
    };
    const avatar = { vfxController: controller } as unknown as Avatar;
    const effect = AVATAR_VFX_CATALOG.find(isHoverVFXEntry);
    if (!effect) throw new Error("Missing hover VFX fixture");

    await expect(
      applyAvatarVFXEffectById({
        avatar,
        effectId: effect.id,
        appliedEffectId: "replaceable-preview-effect",
        effectEntry: effect,
      }),
    ).resolves.toBe(true);

    expect(controller.applyHoverVFX).toHaveBeenCalledWith(
      expect.objectContaining({
        effectId: "replaceable-preview-effect",
        effectEntry: expect.objectContaining({
          id: "replaceable-preview-effect",
        }),
        logicalEffectId: effect.id,
      }),
    );
  });
});

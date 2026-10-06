import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { TEST_HOVER_VFX_ENTRY } from "./avatarVFXTestFixtures";
import { applyAvatarVFXEffectById } from "./runtime";

describe("applyAvatarVFXEffectById", () => {
  it("applies nothing when live runtime resolution returns null", async () => {
    const controller = {
      applyHoverVFX: vi.fn(),
      applyFaceAnchoredVFX: vi.fn(),
      applyTextureVFX: vi.fn(),
    };
    const avatar = { vfxController: controller } as unknown as Avatar;
    await expect(
      applyAvatarVFXEffectById({
        avatar,
        effectId: "star",
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
    const effect = TEST_HOVER_VFX_ENTRY;

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

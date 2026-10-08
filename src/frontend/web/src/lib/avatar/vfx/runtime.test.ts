import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { TEST_HOVER_VFX_ENTRY } from "./avatarVFXTestFixtures";
import { parseAvatarEffectDefinition } from "./definition";
import { applyAvatarVFXEffectById } from "./runtime";

describe("applyAvatarVFXEffectById", () => {
  it("applies nothing when live runtime resolution returns null", async () => {
    const controller = {
      applyHoverVFX: vi.fn(),
      applyFaceAnchoredVFX: vi.fn(),
      applyTextureVFX: vi.fn(),
      findUnavailableFacePart: vi.fn(() => null),
      reportUnavailableFacePart: vi.fn(),
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
      findUnavailableFacePart: vi.fn(() => null),
      reportUnavailableFacePart: vi.fn(),
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

  it("skips and reports an effect whose face part the Avatar lacks", async () => {
    const controller = {
      applyHoverVFX: vi.fn(),
      applyFaceAnchoredVFX: vi.fn(),
      applyTextureVFX: vi.fn(),
      findUnavailableFacePart: vi.fn(() => "eye_left"),
      reportUnavailableFacePart: vi.fn(),
    };
    const avatar = { vfxController: controller } as unknown as Avatar;
    const effect = TEST_HOVER_VFX_ENTRY;

    await expect(
      applyAvatarVFXEffectById({
        avatar,
        effectId: effect.id,
        appliedEffectId: "applied",
        effectEntry: effect,
      }),
    ).resolves.toBe(false);
    expect(controller.applyHoverVFX).not.toHaveBeenCalled();
    expect(controller.reportUnavailableFacePart).toHaveBeenCalledWith(
      effect,
      "eye_left",
    );
  });

  it("applies body, sticker and silhouette effects as attachments", async () => {
    const controller = {
      applyAttachmentVFX: vi.fn(),
      applyHoverVFX: vi.fn(),
      findUnavailableFacePart: vi.fn(() => null),
      reportUnavailableFacePart: vi.fn(),
    };
    const avatar = { vfxController: controller } as unknown as Avatar;
    const effect = parseAvatarEffectDefinition(
      {
        schema: "animama/avatar-effect/2",
        region: "sticker",
        attachment: { kind: "sticker", around: "head" },
        art: { image: "doki.png" },
      },
      {
        id: "doki",
        label: "Doki",
        description: "Doki",
        assetPath: "blob:doki",
      },
    );

    await expect(
      applyAvatarVFXEffectById({
        avatar,
        effectId: "doki",
        appliedEffectId: "clip:event",
        effectEntry: effect,
      }),
    ).resolves.toBe(true);
    expect(controller.applyAttachmentVFX).toHaveBeenCalledWith({
      effectId: "clip:event",
      effectEntry: expect.objectContaining({
        kind: "sticker",
        id: "clip:event",
      }),
      logicalEffectId: "doki",
    });
    expect(controller.applyHoverVFX).not.toHaveBeenCalled();
  });
});

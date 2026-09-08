import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import { updatePoseCreatorAvatarFrame } from "./poseCreatorAvatarFrame";

describe("updatePoseCreatorAvatarFrame", () => {
  it("ticks avatar VFX, VRM, and particle VFX in render order", () => {
    const calls: string[] = [];
    const avatar = {
      vfxController: {
        update: vi.fn(() => calls.push("avatar-vfx")),
      },
      vrm: {
        update: vi.fn(() => calls.push("vrm")),
      },
      particleVFXController: {
        update: vi.fn(() => calls.push("particle-vfx")),
      },
    } as unknown as Avatar;

    updatePoseCreatorAvatarFrame(avatar, 0.016);

    expect(avatar.vfxController?.update).toHaveBeenCalledWith(0.016);
    expect(avatar.vrm?.update).toHaveBeenCalledWith(0.016);
    expect(avatar.particleVFXController?.update).toHaveBeenCalledWith(0.016);
    expect(calls).toEqual(["avatar-vfx", "vrm", "particle-vfx"]);
  });

  it("tolerates an absent avatar", () => {
    expect(() => updatePoseCreatorAvatarFrame(null, 0.016)).not.toThrow();
  });
});

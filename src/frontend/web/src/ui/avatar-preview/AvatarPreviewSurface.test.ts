import { describe, expect, it } from "vitest";

import { resolveAvatarPreviewCameraSettings } from "./AvatarPreviewSurface";

describe("AvatarPreviewSurface camera profiles", () => {
  it("uses full-body framing by default", () => {
    expect(
      resolveAvatarPreviewCameraSettings({
        activeAvatar: null,
        cameraProfile: "full-body",
      }).position.z,
    ).toBe(3.2);
  });

  it("uses portrait framing for reactions", () => {
    const camera = resolveAvatarPreviewCameraSettings({
      activeAvatar: null,
      cameraProfile: "portrait",
    });
    expect(camera.position.z).toBe(1.6);
    expect(camera.orbitTarget.y).toBeCloseTo(1.1);
  });

  it("preserves an explicit custom camera", () => {
    const settings = {
      position: { x: 1, y: 2, z: 3 },
      fov: 42,
      orbitTarget: { x: 0, y: 1, z: 0 },
    };
    expect(
      resolveAvatarPreviewCameraSettings({
        activeAvatar: null,
        cameraProfile: "custom",
        cameraSettings: settings,
      }),
    ).toEqual(settings);
  });
});

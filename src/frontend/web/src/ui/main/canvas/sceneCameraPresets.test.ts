import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { measureAvatarProportions } from "@/lib/avatar/avatarProportions";
import { loadWholeBodyAvatar } from "@/lib/avatar/testing/wholeBodyVrm";

import {
  buildSceneCameraPreset,
  DEFAULT_PIP_SCENE_CAMERA_PRESET,
  isSceneCameraPreset,
} from "./sceneCameraPresets";

describe("scene camera presets", () => {
  it("frames PiP close on the face by default", () => {
    expect(DEFAULT_PIP_SCENE_CAMERA_PRESET).toBe("portrait-close");
  });

  it("accepts only chat presets from untrusted input", () => {
    expect(isSceneCameraPreset("portrait")).toBe(true);
    expect(isSceneCameraPreset("portrait-three-quarter")).toBe(false);
    expect(isSceneCameraPreset({ preset: "portrait" })).toBe(false);
  });
});

describe.each(["portrait", "portrait-close"] as const)(
  "the %s preset",
  (preset) => {
    it("keeps its fixed offsets from the head bone on adult proportions", async () => {
      const avatar = await loadWholeBodyAvatar();
      const headY = avatar.getCameraAnchorY("head")!;
      const { settings, bindings } = buildSceneCameraPreset(preset, {
        avatar,
      });
      const close = preset === "portrait-close";
      expect(settings.position).toEqual({
        x: 0,
        y: headY,
        z: close ? 0.8 : 1.6,
      });
      expect(settings.orbitTarget.y).toBe(close ? headY : headY - 0.1);
      expect(bindings.orbitTargetYOffset).toBe(close ? 0 : -0.1);
    });

    it("frames a big head's whole face", async () => {
      // The head scaled twice about the head bone, as on chibi Avatars.
      const avatar = await loadWholeBodyAvatar({ headScale: 2 });
      const { settings } = buildSceneCameraPreset(preset, { avatar });
      const camera = new THREE.PerspectiveCamera(settings.fov, 16 / 9);
      camera.position.set(
        settings.position.x,
        settings.position.y,
        settings.position.z,
      );
      camera.lookAt(
        settings.orbitTarget.x,
        settings.orbitTarget.y,
        settings.orbitTarget.z,
      );
      camera.updateMatrixWorld(true);

      // The head box's front face and the eyes, in the world.
      avatar.scene!.updateMatrixWorld(true);
      const head = avatar.vrm!.humanoid.getNormalizedBoneNode("head")!;
      const box = measureAvatarProportions(avatar.vrm).headBox!;
      const eyes = avatar.getFaceLandmarksSnapshot()!.eyes;
      const points = [
        new THREE.Vector3(box.min.x, box.min.y, box.max.z),
        new THREE.Vector3(box.max.x, box.min.y, box.max.z),
        new THREE.Vector3(box.min.x, box.max.y, box.max.z),
        new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        new THREE.Vector3().copy(eyes.left!.centerLocal),
        new THREE.Vector3().copy(eyes.right!.centerLocal),
      ].map((point) => head.localToWorld(point).project(camera));
      for (const point of points) {
        expect(Math.abs(point.x)).toBeLessThan(1);
        expect(Math.abs(point.y)).toBeLessThan(1);
      }
      // The eyes sit in the frame's upper half, as on the Included Avatars,
      // rather than at its edge.
      expect(points[4]!.y).toBeGreaterThan(-0.2);
      expect(points[4]!.y).toBeLessThan(0.8);
    });
  },
);

import { PerspectiveCamera } from "three";
import { describe, expect, it, vi } from "vitest";

import { Avatar } from "./Avatar";
import { loadTestAvatarWithGltf } from "./motion-authoring/testing/includedAvatars";
import { AVATAR_FACE_PARTS_SCHEMA } from "./vfx/faceParts";

const detection = vi.hoisted(() => ({ fail: false }));
vi.mock("./vfx/faceParts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./vfx/faceParts")>();
  return {
    ...original,
    detectAvatarFaceParts: (
      ...args: Parameters<typeof original.detectAvatarFaceParts>
    ) => {
      if (detection.fail) throw new Error("unexpected model");
      return original.detectAvatarFaceParts(...args);
    },
  };
});

const DIGEST = "c".repeat(64);

/** An Avatar holding a real Included VRM, as `Avatar.load` leaves it. */
async function loadedAnnie(): Promise<Avatar> {
  const { vrm, gltf } = await loadTestAvatarWithGltf("AvatarSample_A_1_New");
  const avatar = new Avatar(new PerspectiveCamera());
  avatar.vrm = vrm;
  avatar.sourceGltf = gltf;
  (avatar as unknown as { _vrmSha256: string })._vrmSha256 = DIGEST;
  await avatar.setFacePartCorrections(null);
  return avatar;
}

describe("Avatar.setFacePartCorrections", () => {
  it("rebuilds parts and landmarks, and re-applies effects", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const avatar = await loadedAnnie();
    const refresh = vi.fn().mockResolvedValue(undefined);
    avatar.vfxController = {
      refreshFaceParts: refresh,
    } as unknown as Avatar["vfxController"];
    const before = avatar.getFaceLandmarksSnapshot();
    expect(before?.faceBindingKey).toBe("91:0:3");

    // A (deliberately odd) correction: the mouth primitive is the face skin.
    await avatar.setFacePartCorrections({
      schema: AVATAR_FACE_PARTS_SCHEMA,
      vrm_sha256: DIGEST,
      parts: {
        face_skin: ["91:0:0"],
        eye_left: ["91:0:1"],
        eye_right: ["91:0:1"],
        hair: [],
      },
    });

    expect(avatar.facePartMap?.parts.face_skin).toMatchObject({
      bindings: ["91:0:0"],
      source: "corrected",
    });
    expect(avatar.facePartMap?.parts.hair.bindings).toEqual([]);
    expect(avatar.getFaceLandmarksSnapshot()?.faceBindingKey).toBe("91:0:0");
    expect(avatar.getFaceTextureAnchorsSnapshot()?.faceBindingKey).toBe(
      "91:0:0",
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("ignores a correction made for different VRM bytes", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const avatar = await loadedAnnie();
    const detected = avatar.facePartMap?.parts;

    await avatar.setFacePartCorrections({
      schema: AVATAR_FACE_PARTS_SCHEMA,
      vrm_sha256: "d".repeat(64),
      parts: {
        face_skin: ["91:0:4"],
        eye_left: ["91:0:1"],
        eye_right: ["91:0:1"],
      },
    });

    expect(avatar.facePartMap?.parts).toEqual(detected);
    expect(avatar.facePartMap?.diagnostics).toEqual([
      "Ignored face part corrections made for different VRM bytes.",
    ]);
    expect(warn).toHaveBeenCalled();
  });

  it("falls back to name matching when detection throws", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const avatar = await loadedAnnie();
    detection.fail = true;
    try {
      await expect(
        avatar.setFacePartCorrections(null),
      ).resolves.toBeUndefined();
    } finally {
      detection.fail = false;
    }

    expect(avatar.facePartMap).toBeNull();
    expect(
      warn.mock.calls.some(
        ([, data]) =>
          (data as { reason?: string } | undefined)?.reason ===
          "avatar_face_parts_detection_failed",
      ),
    ).toBe(true);
    // Names find the same face skin, so landmarks stay ready.
    expect(avatar.getFaceLandmarksSnapshot()).toMatchObject({
      status: "ready",
      faceBindingKey: "91:0:3",
    });
  });
});

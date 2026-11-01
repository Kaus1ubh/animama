import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { loadHeadlessVrmWithGltf } from "../motion-authoring/headlessVrm";
import {
  VRM0_FIXTURE_ID,
  readTestAvatarBytes,
} from "../motion-authoring/testing/includedAvatars";
import {
  loadedTestAvatar,
  prepareTestAvatar,
} from "../testing/loadedTestAvatar";
import {
  DISTAL_FINGER_BONES,
  withoutHumanBones,
} from "../testing/withoutHumanBones";
import {
  AVATAR_FACE_PARTS_SCHEMA,
  type AvatarFacePartCorrections,
} from "../vfx/faceParts";
import { isStandardExpressionName } from "./avatarDiagnostics";
import type { AvatarIssue } from "./issues";

const detection = vi.hoisted(() => ({ fail: false }));
vi.mock("../vfx/faceParts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../vfx/faceParts")>();
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

function codes(avatar: Avatar): string[] {
  return avatar.getDiagnostics()!.issues.map((issue) => issue.code);
}

/** Stand-ins for the spring and effect controllers' snapshots. */
function withControllerIssues(
  avatar: Avatar,
  springs: AvatarIssue[],
  effects: AvatarIssue[],
): void {
  avatar.springBonePhysicsController = {
    getSnapshot: () => ({ issues: springs }),
  } as unknown as Avatar["springBonePhysicsController"];
  avatar.vfxController = {
    getSnapshot: () => ({ issues: effects }),
    refreshFaceParts: async () => {},
    restoreHiddenRegions: () => {},
  } as unknown as Avatar["vfxController"];
}

beforeEach(() => {
  detection.fail = false;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Avatar diagnostics", () => {
  it.each(["Andrew", "Annie", VRM0_FIXTURE_ID] as const)(
    "find no problems on %s",
    async (id) => {
      const avatar = await loadedTestAvatar(id, DIGEST);
      const diagnostics = avatar.getDiagnostics()!;

      expect(diagnostics.issues).toEqual([]);
      expect(diagnostics.face).toMatchObject({
        detected: true,
        landmarks: "ready",
        textureAnchors: "ready",
      });
      expect(
        diagnostics.face.parts.find((part) => part.role === "face_skin"),
      ).toMatchObject({ source: "signals", bindingCount: 1 });
      expect(diagnostics.expressions.presets).toContainEqual({
        name: "happy",
        source: "model",
      });
      // The Included Avatars look with eye bones, so look expressions are not missing.
      expect(diagnostics.expressions.missingPresets).not.toContain("lookUp");
      expect(diagnostics.expressions.unresolved).toEqual({
        names: [],
        otherCount: 0,
      });
      expect(diagnostics.motion.humanoidBones).toBeGreaterThan(20);
      expect(diagnostics.motion.missingRequiredBones).toEqual([]);
      expect(diagnostics.motion.missingOptionalBones).toEqual([]);
      expect(diagnostics.motion.springJoints).toBeGreaterThan(0);
    },
  );

  it("list missing optional bones with what stands in for them", async () => {
    const { vrm, gltf } = await loadHeadlessVrmWithGltf(
      withoutHumanBones(await readTestAvatarBytes("Andrew"), [
        "upperChest",
        "leftEye",
        "rightEye",
        ...DISTAL_FINGER_BONES,
      ]),
      { removeUnnecessaryVertices: true },
    );
    const avatar = await prepareTestAvatar(vrm, gltf, DIGEST);
    const { motion } = avatar.getDiagnostics()!;
    expect(motion.missingRequiredBones).toEqual([]);
    expect(motion.missingOptionalBones).toContainEqual({
      bone: "upperChest",
      standIn: "chest",
      covers: "motion_and_contacts",
    });
    expect(motion.missingOptionalBones).toContainEqual({
      bone: "rightIndexDistal",
      standIn: "rightIndexIntermediate",
      covers: "contacts",
    });
    expect(motion.missingOptionalBones).toContainEqual({
      bone: "leftThumbDistal",
      standIn: "leftThumbProximal",
      covers: "contacts",
    });
    expect(motion.missingOptionalBones).toContainEqual({
      bone: "leftEye",
      standIn: null,
      covers: "nothing",
    });
    // Upper chest, two eyes and ten distal segments; Andrew has no jaw,
    // which no content moves.
    expect(motion.missingOptionalBones).toHaveLength(13);
  });

  it("report an ignored correction and its unknown bindings once each", async () => {
    const avatar = await loadedTestAvatar("Annie", DIGEST);
    const correction: AvatarFacePartCorrections = {
      schema: AVATAR_FACE_PARTS_SCHEMA,
      vrm_sha256: DIGEST,
      parts: {
        face_skin: ["91:0:3", "999:0:0", "998:0:0"],
        eye_left: ["91:0:1"],
        eye_right: ["91:0:1"],
      },
    };
    await avatar.setFacePartCorrections(correction);
    await avatar.setFacePartCorrections(correction);
    expect(avatar.getDiagnostics()!.issues).toEqual([
      {
        code: "face_parts_correction_unknown_bindings",
        params: { part: "face_skin", count: 2 },
      },
    ]);

    await avatar.setFacePartCorrections({
      ...correction,
      vrm_sha256: "d".repeat(64),
    });
    expect(codes(avatar)).toEqual(["face_parts_correction_other_file"]);
  });

  it("report a failed part detection and what it leaves unavailable", async () => {
    const avatar = await loadedTestAvatar("Annie", DIGEST);
    detection.fail = true;
    await avatar.setFacePartCorrections(null);
    const diagnostics = avatar.getDiagnostics()!;
    expect(diagnostics.face.detected).toBe(false);
    expect(codes(avatar)[0]).toBe("face_parts_detection_failed");
    // Each code once, whichever face stage reported it.
    expect(new Set(codes(avatar)).size).toBe(codes(avatar).length);
  });

  it("report a model without blink or aa", async () => {
    const avatar = await loadedTestAvatar("Andrew", DIGEST);
    const manager = avatar.vrm!.expressionManager!;
    manager.unregisterExpression(manager.getExpression("blink")!);
    await avatar.setFacePartCorrections(null);
    expect(codes(avatar)).toContain("face_parts_expressions_missing");
  });

  it("merge spring and effect findings with the face's, without repeats", async () => {
    const avatar = await loadedTestAvatar("Andrew", DIGEST);
    const limit: AvatarIssue = {
      code: "effect_attachment_limit",
      params: { effectId: "content-1", limit: 4 },
    };
    withControllerIssues(
      avatar,
      [{ code: "springs_metadata_missing" }],
      [limit, { ...limit, params: { limit: 4, effectId: "content-1" } }],
    );
    expect(avatar.getDiagnostics()!.issues).toEqual([
      { code: "springs_metadata_missing" },
      limit,
    ]);
  });

  it("notify subscribers when the face parts change", async () => {
    const avatar = await loadedTestAvatar("Andrew", DIGEST);
    const listener = vi.fn();
    const unsubscribe = avatar.subscribeDiagnostics(listener);
    await avatar.setFacePartCorrections(null);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    await avatar.setFacePartCorrections(null);
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("isStandardExpressionName", () => {
  it("allows VRM presets, ARKit shapes and VRoid parts only", () => {
    expect(isStandardExpressionName("happy")).toBe(true);
    expect(isStandardExpressionName("jawOpen")).toBe(true);
    expect(isStandardExpressionName("Fcl_MTH_A")).toBe(true);
    expect(isStandardExpressionName("author_smile_2")).toBe(false);
  });
});

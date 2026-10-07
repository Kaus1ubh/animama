import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import type {
  PyAnimaRuntime,
  PyRuntimeAvatar,
} from "@/lib/content/catalogTypes";
import {
  AVATAR_FACE_PARTS_SCHEMA,
  detectAvatarFaceParts,
  type AvatarFacePartCorrections,
} from "@/lib/avatar/vfx/faceParts";
import { loadTestAvatarWithGltf } from "@/lib/avatar/motion-authoring/testing/includedAvatars";

import { resolveRuntimeAvatarFaceParts } from "./runtimeAvatarFaceParts";
import { adaptRuntimeSnapshot } from "./runtimeSnapshotAdapter";

const ANNIE = fileURLToPath(
  new URL(
    "../../../../../../content/included/avatars/AvatarSample_A_1_New.vrm",
    import.meta.url,
  ),
);

function snapshot(avatar: Partial<PyRuntimeAvatar>, sha256: string) {
  return adaptRuntimeSnapshot({
    catalog_version: 1,
    loadout_revision: 1,
    effective_revision: "tr1-avatar",
    lease_expires_at: "2026-08-11T00:00:00Z",
    content_descriptor: {
      revision: "rcd1-test",
      total_bytes: 0,
      roots: [],
      entries: [],
      members: [],
      diagnostics: [],
    },
    avatar: {
      source: {
        type: "catalog_item",
        item_id: "annie",
        source: "included",
        revision: "builtin:annie:1",
      },
      avatar_id: "annie",
      revision: "builtin:annie:1",
      files: [
        {
          file_ref: "annie-vrm",
          role: "model",
          ordinal: 1,
          filename: "AvatarSample_A_1_New.vrm",
          media_type: "model/gltf-binary",
          size_bytes: 100,
          sha256,
          url: "/v1/content/files/annie-vrm",
        },
      ],
      ...avatar,
    },
    gestures: [],
    reactions: [],
    particle_effects: [],
    avatar_effects: [],
    scene_effects: [],
    sound_effects: [],
    warnings: [],
  } satisfies PyAnimaRuntime);
}

function correction(vrmSha256: string): AvatarFacePartCorrections {
  return {
    schema: AVATAR_FACE_PARTS_SCHEMA,
    vrm_sha256: vrmSha256,
    parts: {
      face_skin: ["91:0:3"],
      eye_left: ["91:0:1"],
      eye_right: ["91:0:1"],
      // The user marked the highlight as absent on this model.
      eye_highlight: [],
    },
  };
}

describe("resolveRuntimeAvatarFaceParts", () => {
  it("is empty without a runtime Avatar", () => {
    expect(resolveRuntimeAvatarFaceParts(null)).toEqual({
      facePartCorrections: null,
      vrmSha256: null,
    });
  });

  it("drops an invalid correction and keeps the VRM digest", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = snapshot(
      { face_parts: { schema: "other" } as never },
      "b".repeat(64),
    );
    expect(resolveRuntimeAvatarFaceParts(runtime.avatar_model)).toEqual({
      facePartCorrections: null,
      vrmSha256: "b".repeat(64),
    });
  });

  it("applies a saved correction from the runtime snapshot to the loaded Avatar", async () => {
    const bytes = await readFile(ANNIE);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const runtime = snapshot({ face_parts: correction(sha256) }, sha256);

    const loadOptions = resolveRuntimeAvatarFaceParts(runtime.avatar_model);
    expect(loadOptions).toEqual({
      facePartCorrections: correction(sha256),
      vrmSha256: sha256,
    });

    // What `Avatar.load` does with these options.
    const { vrm, gltf } = await loadTestAvatarWithGltf("AvatarSample_A_1_New");
    const map = detectAvatarFaceParts(vrm, gltf, {
      corrections: loadOptions.facePartCorrections,
      vrmSha256: loadOptions.vrmSha256,
    });
    expect(map.parts.face_skin).toMatchObject({
      bindings: ["91:0:3"],
      source: "corrected",
    });
    expect(map.parts.eye_highlight).toMatchObject({
      bindings: [],
      source: "corrected",
    });
    expect(map.parts.eyeline.source).toBe("signals");
    expect(map.diagnostics).toEqual([]);
  });
});

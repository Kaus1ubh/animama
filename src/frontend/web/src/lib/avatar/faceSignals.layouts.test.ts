import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AvatarExpressionSource } from "./diagnostics/avatarDiagnostics";
import { FACE_SIGNAL_PRESETS } from "./faceSignals";
import { loadTestAvatarWithGltf } from "./motion-authoring/testing/includedAvatars";
import { rewriteFaceSignals } from "./testing/faceSignalLayouts";
import {
  loadedTestAvatar,
  prepareTestAvatar,
} from "./testing/loadedTestAvatar";
import { AVATAR_FACE_PART_ROLES } from "./vfx/faceParts";

/**
 * Annie's face rewritten as converted Avatars carry blink and mouth shapes:
 * only VRM 0-style empty presets, and VRoid's eye-closing and vowel morphs
 * under ARKit, MMD or VRChat names (synthetic renames of an Included Avatar;
 * no third-party data). Face parts and Diagnostics must come out as on the
 * unmodified Avatar, with each signal's source shown.
 */
const AVATAR = "Annie";
const DIGEST = "c".repeat(64);

type Layout = {
  rename: Readonly<Record<string, string>>;
  empty: readonly string[];
  /** Diagnostics sources for some presets; absent ones are missing. */
  present: Readonly<Record<string, AvatarExpressionSource>>;
  missing: readonly string[];
};

const LAYOUTS: Record<string, Layout> = {
  // A mouth swapped between separate meshes by materials, or never authored:
  // the visemes morph nothing, and the face is found from blink alone.
  "visemes that move no mesh": {
    rename: {},
    empty: ["aa", "ih", "ou", "ee", "oh"],
    present: { blink: "model", blinkLeft: "model" },
    missing: ["aa", "ih", "ou", "ee", "oh"],
  },
  "left and right blinks only": {
    rename: {},
    empty: ["blink"],
    present: { blink: "left_right", blinkLeft: "model", aa: "model" },
    missing: [],
  },
  ARKit: {
    rename: {
      Fcl_EYE_Close_L: "eyeBlinkLeft",
      Fcl_EYE_Close_R: "eyeBlinkRight",
      // The shapes ARKit's "A" mix uses, on the vowel morphs.
      Fcl_MTH_A: "jawOpen",
      Fcl_MTH_I: "mouthLowerDownLeft",
      Fcl_MTH_U: "mouthLowerDownRight",
      Fcl_MTH_E: "mouthUpperUpLeft",
      Fcl_MTH_O: "mouthUpperUpRight",
    },
    empty: FACE_SIGNAL_PRESETS,
    present: { blink: "arkit", blinkLeft: "arkit", aa: "arkit" },
    // The other vowels' mixes need shapes this face lacks.
    missing: ["ih", "ou", "ee", "oh"],
  },
  MMD: {
    rename: { Fcl_EYE_Close: "まばたき", Fcl_MTH_A: "あ" },
    empty: FACE_SIGNAL_PRESETS,
    present: { blink: "mmd", aa: "mmd" },
    missing: ["blinkLeft", "blinkRight", "ih"],
  },
  VRChat: {
    rename: {
      Fcl_EYE_Close_L: "vrc.blink_left",
      Fcl_EYE_Close_R: "vrc.blink_right",
      Fcl_MTH_A: "vrc.v_aa",
      Fcl_MTH_I: "vrc.v_ih",
      Fcl_MTH_U: "vrc.v_ou",
      Fcl_MTH_E: "vrc.v_e",
      Fcl_MTH_O: "vrc.v_oh",
    },
    empty: FACE_SIGNAL_PRESETS,
    present: {
      blink: "vrchat",
      blinkLeft: "vrchat",
      blinkRight: "vrchat",
      aa: "vrchat",
      oh: "vrchat",
    },
    missing: [],
  },
};

/** Each face part's bindings and regions, as detection found them. */
async function partsOf(avatar: Awaited<ReturnType<typeof loadedTestAvatar>>) {
  const map = avatar.facePartMap!;
  return Object.fromEntries(
    AVATAR_FACE_PART_ROLES.map((role) => [
      role,
      {
        source: map.parts[role].source,
        bindings: map.parts[role].bindings,
        regions: map.parts[role].regions ?? [],
      },
    ]),
  );
}

async function rewrittenAvatar(layout: Pick<Layout, "rename" | "empty">) {
  const { vrm, gltf } = await loadTestAvatarWithGltf(AVATAR);
  rewriteFaceSignals(vrm, layout);
  return prepareTestAvatar(vrm, gltf, DIGEST);
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("face signals on rewritten Included Avatar faces", () => {
  it.each(Object.entries(LAYOUTS))(
    "%s: finds the face and shows each signal's source",
    async (_name, layout) => {
      const reference = await partsOf(await loadedTestAvatar(AVATAR, DIGEST));
      const avatar = await rewrittenAvatar(layout);

      expect(await partsOf(avatar)).toEqual(reference);
      const diagnostics = avatar.getDiagnostics()!;
      expect(diagnostics.issues.map((issue) => issue.code)).not.toContain(
        "face_parts_expressions_missing",
      );
      for (const [name, source] of Object.entries(layout.present)) {
        expect(diagnostics.expressions.presets, name).toContainEqual({
          name,
          source,
        });
      }
      for (const name of layout.missing) {
        expect(diagnostics.expressions.missingPresets, name).toContain(name);
        expect(
          diagnostics.expressions.presets.map((preset) => preset.name),
        ).not.toContain(name);
      }
    },
  );

  it("still reports a face with no blink shape under any name", async () => {
    const avatar = await rewrittenAvatar({
      rename: {},
      empty: ["blink", "blinkLeft", "blinkRight"],
    });
    const diagnostics = avatar.getDiagnostics()!;

    expect(diagnostics.issues.map((issue) => issue.code)).toContain(
      "face_parts_expressions_missing",
    );
    expect(diagnostics.expressions.missingPresets).toEqual(
      expect.arrayContaining(["blink", "blinkLeft", "blinkRight"]),
    );
    expect(avatar.facePartMap!.parts.face_skin.source).not.toBe("signals");
  });
});

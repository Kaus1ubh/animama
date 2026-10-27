import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { collectAvatarLiveDiagnostics } from "./diagnostics/avatarDiagnostics";
import { ExpressionController } from "./ExpressionController";
import { irisHideBindOf } from "./irisHideExpression";
import { prepareLoadedVrm } from "./prepareLoadedVrm";
import { morphInfluence, syntheticFaceVrm } from "./testing/syntheticFaceVrm";
import type { Avatar } from "./Avatar";

const includedContent = fileURLToPath(
  new URL("../../../../../../content/included/", import.meta.url),
);

/** Every `Fcl_*` name keyed anywhere in Included content. */
async function includedFaceNames(): Promise<string[]> {
  const names = new Set<string>();
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name.endsWith(".json")) {
        for (const match of (await readFile(path, "utf8")).matchAll(
          /"(Fcl_[A-Za-z_]+)"/g,
        )) {
          names.add(match[1]!);
        }
      }
    }
  };
  await visit(includedContent);
  return [...names].sort();
}

const MOOD_PRESETS = ["happy", "relaxed", "sad", "angry", "surprised"];

/**
 * A model with only VRM presets: the moods, blink and the visemes, each on a
 * morph of its own.
 */
function presetOnlyAvatar(presets = [...MOOD_PRESETS, "blink", "aa", "oh"]) {
  return syntheticFaceVrm({ morphs: presets, presets });
}

describe("Included content's face names", () => {
  it("each resolves on a preset-only model, or is reported", async () => {
    const names = await includedFaceNames();
    // The mood parts and the few others Included content keys.
    expect(names.length).toBeGreaterThanOrEqual(18);
    const { vrm, mesh } = presetOnlyAvatar();
    prepareLoadedVrm(vrm, { vrmSha256: null });
    const controller = new ExpressionController(vrm);
    const moved = (name: string) => {
      controller.setExpressionOverlay("probe", { [name]: 1 });
      controller.update(1 / 30);
      const any = [...MOOD_PRESETS, "blink"].some(
        (preset) => morphInfluence(mesh, preset) > 0,
      );
      controller.clearExpressionOverlay("probe");
      controller.update(1 / 30);
      return any || vrm.expressionManager!.getExpression(name) !== null;
    };
    const unresolved = new Set(controller.unresolvedExpressionNames);
    for (const name of names) {
      if (moved(name)) continue;
      expect(
        new Set(controller.unresolvedExpressionNames),
        `${name} neither plays nor is reported`,
      ).toContain(name);
      unresolved.add(name);
    }
    // Only mouth parts lack a stand-in without MMD or ARKit shapes: a mood
    // preset would move the brows and eyes too.
    expect([...unresolved].every((name) => name.startsWith("Fcl_MTH_"))).toBe(
      true,
    );
    controller.dispose();
  });
});

describe("faces without mood shapes", () => {
  it("stay neutral, say so, and never use visemes for moods", () => {
    // Owner decision 8: only a blink and the visemes.
    const { vrm, mesh } = presetOnlyAvatar(["blink", "aa", "oh"]);
    const { arkitFace } = prepareLoadedVrm(vrm, { vrmSha256: null });
    expect(Object.values(arkitFace.moods)).toEqual(
      MOOD_PRESETS.map(() => ({ brow: "none", eye: "none", mouth: "none" })),
    );
    const controller = new ExpressionController(vrm);
    controller.playEmotion("delight", 3);
    controller.playEmotion("alarm", 3);
    for (let frame = 0; frame < 60; frame += 1) controller.update(1 / 30);
    expect(morphInfluence(mesh, "aa")).toBe(0);
    expect(morphInfluence(mesh, "oh")).toBe(0);

    const diagnostics = collectAvatarLiveDiagnostics({
      vrm,
      arkitFace,
      expressionController: controller,
      loadIssues: [],
      facePartMap: null,
      getFaceLandmarksSnapshot: () => null,
      getFaceTextureAnchorsSnapshot: () => null,
      springMode: "automatic",
      ambientForces: false,
      lilToonMaterials: "none",
    } as unknown as Avatar);
    expect(diagnostics.issues).toContainEqual({
      code: "face_expressions_none",
    });
    controller.dispose();
  });
});

describe("faces whose mood presets bind nothing", () => {
  it("count as without mood shapes", () => {
    const { vrm } = syntheticFaceVrm({
      morphs: ["blink", "aa"],
      presets: ["blink", "aa"],
      presetBinds: Object.fromEntries(MOOD_PRESETS.map((name) => [name, []])),
    });
    const { arkitFace } = prepareLoadedVrm(vrm, { vrmSha256: null });
    expect(Object.values(arkitFace.moods)).toEqual(
      MOOD_PRESETS.map(() => ({ brow: "none", eye: "none", mouth: "none" })),
    );
    const controller = new ExpressionController(vrm);
    controller.playEmotion("gloom", 2);
    expect(controller.unresolvedExpressionNames).toContain("sad");
    // A part whose fallback preset is empty is reported, not dropped.
    controller.setExpressionOverlay("reaction", { Fcl_EYE_Sorrow: 1 });
    expect(controller.unresolvedExpressionNames).toContain("Fcl_EYE_Sorrow");
    controller.dispose();
  });
});

describe("Fcl_EYE_Iris_Hide on a model without it", () => {
  it("reports whether it is held, once per change", () => {
    const { vrm } = presetOnlyAvatar();
    prepareLoadedVrm(vrm, { vrmSha256: null });
    const bind = irisHideBindOf(vrm)!;
    const states: boolean[] = [];
    bind.setListener((hidden) => states.push(hidden));
    const manager = vrm.expressionManager!;
    manager.setValue("Fcl_EYE_Iris_Hide", 1);
    manager.update();
    manager.update();
    manager.setValue("Fcl_EYE_Iris_Hide", 0.2);
    manager.update();
    expect(states).toEqual([true, false]);
  });

  it("keeps a model's own shape", () => {
    const { vrm } = syntheticFaceVrm({
      morphs: ["Fcl_EYE_Iris_Hide", "blink"],
      presets: ["blink"],
    });
    prepareLoadedVrm(vrm, { vrmSha256: null });
    expect(irisHideBindOf(vrm)).toBeNull();
  });
});
